const fs = require('fs')
const path = require('path')
const UUID = require('uuid')
const crypto = require('crypto')
const Promise = require('bluebird')

const fileAttr = require('./file-attr')
const { btrfsConcat } = require('../../lib/btrfs')
const readdirAsync = Promise.promisify(require('./readdir'))

const EINVAL = (message) => Object.assign(new Error(message), { code: 'EINVAL' })

class BACKUP {
  constructor(vfs) {
    this.vfs = vfs
    this.lock = new Map()
  }

  call(op, args, callback) {
    let { target, dirPath, hash } = args
    let lockKey
    if (target) {
      lockKey = target
    } else if (dirPath && hash) {
      lockKey = path.join(dirPath, hash)
    } else if (dirPath) { // for create whiteout
      lockKey = path.join(dirPath, '.whiteout.')
    } else {
      return callback('invaild op')
    }
    let cb = (...args) => {
      let ops = this.lock.get(lockKey)
      ops.shift() // clean self
      if (ops.length) this.schedule(lockKey)
      else this.lock.delete(lockKey)
      process.nextTick(() => callback(...args))
    }
    if (this.lock.has(lockKey)) {
      this.lock.get(lockKey).push({ op, args, cb })
    } else {
      this.lock.set(lockKey, [{ op, args, cb }])
      this.schedule(lockKey)
    }
  }

  schedule(key) {
    let ops = this.lock.get(key)
    if (!ops || !ops.length) throw new Error('lock error')
    let { op, args, cb } = op[0]
    fileAttr[op](args, cb)
  }
  

  delete(user, props, callback) {
    let { hash, fileUUID, name, driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (hash || fileUUID) {
        if (hash && fileUUID) { // file
          let args = { dirPath: dir.abspath(), hash, fileUUID }
          let done = () => fileAttr.deleteFileAttr(args, (err, fattr) => {
            if (err) return callback(err)
            args = { dirPath: dir.abspath(), props: Object.assign(fattr, { hash }) }
            return fileAttr.createWhiteout(args, callback)
          })
          fs.lstat(path.join(dir.abspath(), hash), (err, stat) => {
            if (err) return callback(err)
            if (stat.size > 1024 * 1024 * 1024) {
              this.deleteSameFpAsync(dir.abspath(), props.dirUUID, hash)
                .then(x => (console.log(`backup ${hash} clean up`), done()))
                .catch(e => (console.log(e), done()))
            } else
              done()
          })
        } else {
          return callback(new Error('delete file must fileUUID && hash'))
        }
      } else {
        // if top dir, force delete without deleted stub
        let forceDelete = dir.root().uuid === dir.uuid
        let args = { target: path.join(dir.abspath(), name), props: { deleted: true, forceDelete } }
        return fileAttr.updateDirAttr(args, callback)
      }
    })
  }

  // delete unused intermediate append file
  async deleteSameFpAsync(dirPath, dirUUID, fingerprint) {
    let xstats = (await readdirAsync(dirPath, dirUUID, null)).living
    let finalFiles = xstats.filter(x => x.hash === fingerprint)
    if (!finalFiles.length || finalFiles.length === 1) {
      let deleteFileAttrAsync = Promise.promisify(fileAttr.deleteFileAttr)
      let midFiles = xstats.filter(x => x.fingerprint === fingerprint && x.hash !== fingerprint).map(x => [x.hash, x.uuid])
      for (let i = 0; i < midFiles.length; i++) {
        try{
          let args = { dirPath, hash: midFiles[i][0], fileUUID:midFiles[i][1] }
          await deleteFileAttrAsync(args)
        } catch(e) {}
      }
    } else
      return 
  }

  findArchivedParent (dir) {
    let archivedP
    do {
      if (dir.archived)
        archivedP = dir
    } while(dir = dir.parent)
    return archivedP
  }

  mkdir(user, props, callback){
    let { metadata, bctime, bmtime, name, driveUUID, archived } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (archived && typeof archived !== 'boolean') return process.nextTick(() => callback(new Error('archived must type of boolean')))
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.deleted) return callback(Object.assign(new Error('invaild op for deleted dir'), { status:400 }))
      let uuid, dirname = UUID.v4()
      if (dir.uuid === dir.root().uuid) { // top dir
        metadata = typeof metadata === 'object' ? metadata : {}
        metadata.name = name
        uuid = dirname
      } else {
        dirname = name
        metadata = undefined
      }
      let target = path.join(dir.abspath(), dirname)
      let args = { target, attrs: { metadata, uuid, bctime, bmtime, bname:name, archived, deleted: undefined } }
      fileAttr.createDir(args, callback)
    })
  }
  /**
   * 
   * @param {object} user 
   * @param {object} props 
   *   - uuid, archived, bctime, bmtime, fingerprint, bname, desc, sha256
   * @param {function} callback 
   */
  newfile(user, props, callback){
    let { driveUUID, sha256, data } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.deleted) return callback(Object.assign(new Error('invaild op for deleted dir'), { status:400 }))
      props.uuid = undefined  // clean uuid
      let args = { tmp: data, dirPath: dir.abspath(), hash: sha256, attrs: props }
      fileAttr.createFile(args, (err, data) => {
        if (err) return callback(err)
        return callback(null, Object.assign(data, { hash: sha256, name: props.name }))
      })
    })
  }

  /**
  APPEND data after an existing file
  @param {object} user
  @param {object} props
  @param {object} props.name - file name
  @param {object} props.hash - fingerprint of existing file (before appending)
  @param {object} props.data - data file
  @param {object} props.size - data size (not used?)
  @param {object} props.sha256 -data sha256
  @param {object} props.fingerprint - the final file fingerprint
    -- uuid, archived, bctime, bmtime, fingerprint, bname, desc, sha256
  */
  append(user, props, callback) {
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err) 
      if (dir.deleted) return callback(Object.assign(new Error('invaild op for deleted dir'), { status:400 }))
      let { hash, data, sha256 } = props
      let target = path.join(dir.abspath(), hash)
      fs.lstat(target, (err, stat) => {
        if (err) return callback(err)
        if (!stat.isFile()) {
          let err = new Error('not a file')
          err.code = 'EISDIR'
          err.status = 403
          return callback(err)
        }
        
        if (stat.size % (1024 * 1024 * 1024) !== 0) {
          let err = new Error('not a multiple of 1G')
          err.code = 'EALIGN' // kernel use EINVAL for non-alignment of sector size
          err.status = 403
          return callback(err)
        }

        let tmp = this.vfs.TMPFILE()
        btrfsConcat(tmp, [target, data], err => {
          if (err) return callback(err)
          fs.lstat(target, (err, stat2) => {
            if (err) return callback(err)
            if (stat2.mtime.getTime() !== stat.mtime.getTime()) {
              let err = new Error('race detected')
              err.code = 'ERACE'
              err.status = 403
              return callback(err)
            }
            const combineHash = (a, b) => {
              let a1 = typeof a === 'string' ? Buffer.from(a, 'hex') : a
              let b1 = typeof b === 'string' ? Buffer.from(b, 'hex') : b
              let hash = crypto.createHash('sha256')
              hash.update(Buffer.concat([a1, b1]))
              let digest = hash.digest('hex')
              return digest
            }
            sha256 = stat.size === 0 ? sha256 : combineHash(hash, sha256)
            props.sha256 = sha256  // translate
            props.uuid = undefined  // clean uuid
            let args = { tmp, dirPath: dir.abspath(), hash: sha256, attrs: props }
            fileAttr.createFile(args, (err, data) => {
              if (err) return callback(err)
              return callback(null, Object.assign(data, { hash: sha256, name: props.name }))
            })
          })
        })
      })
    })
  }

  rename(user, props, callback) {
    callback(Object.assign(new Error('unsupport'), { code: 400 }))
  }

  updateAttr(user, props,callback) {
    let { driveUUID, hash, fileUUID, name } = props || {}
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    if (!this.vfs.userCanWriteDrive(user, drive))
      return process.nextTick(() => callback(new Error('Permission Denied')))
    if (hash && fileUUID) {
      return this.updateFile(user, props, callback)
    } else {
      return this.updateDir(user, props, callback)
    }
  }

  updateFile(user, props, callback) {
    let { hash, fileUUID, name } = props || {}
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (name) props.bname = name
      let args = { dirPath: dir.abspath(), hash, fileUUID, props }
      fileAttr.updateFileAttr(args, callback)
    })
  }

  updateDir(user, props, callback) {
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.root().uuid !== dir.uuid) delete props.metadata // not support
      let args = {
        target: path.join(dir.abspath(), props.name),
        props
      }
      fileAttr.updateDirAttr(args, callback)
    })
  }

  /**
  @rewrite for backup becouse of paths
    add
  @param {boolean} xcopy - true or false - for match xcopy
  */
  dirGET(user, props, callback) {
    let dir, root, drive

    // find dir
    dir = this.vfs.forest.uuidMap.get(props.dirUUID)
    if (!dir) {
      let err = new Error('dir not found')
      err.status = 404
      return process.nextTick(() => callback(err))
    }

    // find root
    root = dir.root()

    // find drive 
    drive = this.vfs.drives.find(d => d.uuid === root.uuid)

    if (drive.type !== 'backup') return process.nextTick(() => callback('drive not backup'))

    /**
    If driveUUID is provided, the corresponding drive must contains dir.
    */
    if (props.driveUUID && props.driveUUID !== drive.uuid) {
      let err = new Error('drive does not contain dir')
      err.status = 403
      return process.nextTick(() => callback(err))
    }

    if (!this.vfs.userCanWriteDrive(user, drive)) {
      let err = new Error('permission denied')
      err.status = 403 // TODO 404?
      return process.nextTick(() => callback(err))
    }

    // TODO it is possible that dir root is changed during read 
    dir.read((err, entries, whiteout) => {
      if (err) {
        err.status = 500
        callback(err)
      } else {
        let path = dir.nodepath().map(dir => ({
          uuid: dir.uuid,
          name: dir.bname,
          mtime: Math.abs(dir.mtime)
        }))
        if (!props.xcopy && Array.isArray(whiteout)) {
          whiteout.forEach(w => entries.push(Object.assign({}, w, { deleted: true })))
        }

        if (props.xcopy) {
          entries.forEach(e => {
            if (e.type === 'file') {
              e.namec = e.name
              e.name = e.hash
            }
          })
        }

        callback(null, { path, entries })
      }
    })
  }

  READDIR(user, props, callback) {
    props.xcopy = true
    this.dirGET(user, props, (err, combined) => {
      if (err) return callback(err)
      callback(null, combined.entries)
    })
  }

}

module.exports = BACKUP