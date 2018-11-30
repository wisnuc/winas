const fs = require('fs')
const path = require('path')
const moment = require('moment')

const rimraf = require('rimraf')
const mkdirp = require('mkdirp')

const WO_UUID = '13d20466-9893-4835-a436-1d4b3a0e26f7'

const { isUUID, isSHA256, isNonEmptyString } = require('../../lib/assertion')
const UUID = require('uuid')

const EINVAL = (message) => Object.assign(new Error(message), { code: 'EINVAL' })

class BACKUP {
  constructor(vfs) {
    this.vfs = vfs
  }

  archive(user, props, callback) {
    let { hash, fileUUID, name, driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (hash || fileUUID) {
        if (hash && fileUUID) { // file
          return this.updateFileAttr(dir.abspath(), hash, fileUUID, { archived: true }, callback)
        } else {
          return callback(new Error('archive file must fileUUID && hash'))
        }
      }
      //dir
      return this.updateDirAttr(path.join(dir.abspath(), name), { archived: true }, callback)
    })
  }

  unarchive(user, props, callback) {
    let { hash, fileUUID, name, driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (hash || fileUUID) {
        if (hash && fileUUID) { // file
          return this.updateFileAttr(dir.abspath(), hash, fileUUID, { archived: false }, callback)
        } else {
          return callback(new Error('archive file must fileUUID && hash'))
        }
      }
      //dir
      return this.updateDirAttr(path.join(dir.abspath(), name), { archived: false }, callback)
    })
  }

  delete(user, props, callback) {
    let { hash, fileUUID, name, driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (hash || fileUUID) {
        if (hash && fileUUID) { // file
          this.deleteFileAttr(dir.abspath(), hash, fileUUID, (err, fattr) => {
            if (err) return callback(err)
            return this.createWhiteout(dir.abspath, fattr, callback)
          })
        } else {
          return callback(new Error('delete file must fileUUID && hash'))
        }
      }
      //dir
      return this.updateDirAttr(path.join(dir.abspath(), name), { deleted: true }, callback)
    })
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
    let { metadata, bctime, bmtime, name, driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      let uuid, dirname = UUID.v4()
      if (dir.uuid === dir.root().uuid) { // top dir
        metadata = typeof metadata === 'object' ? metadata : {}
        metadata.name = name
        uuid = dirname
      } else {
        dirname = name
        metadata = undefined
      }
      let target = path.join(this.absolutePath(dir), dirname)
      this.createDir(target, { metadata, uuid, bctime, bmtime, bname:name }, callback)
    })
  }

  newfile(user, props, callback){
    let { driveUUID, hash, data } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      this.createFile(data, dir.abspath(), hash, props, callback)
    })
  }

  updateFile(user, props, callback) {
    let { driveUUID, hash, fileUUID, name } = props || {}
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (name) props.bname = name
      this.updateFileAttr(dir.abspath(), hash, fileUUID, props, callback)
    })
  }

  updateDir(user, props, callback) {
    let { driveUUID } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      this.updateDirAttr(dir.abspath(), props, callback)
    })
  }

  append() {}

  updateDirAttr(target, props, callback) {
    let { bctime, bmtime, metadata, bname, archived, deleted } = props || {}
    let attr = {}
    if (bctime) attr.bctime = bctime
    if (bmtime) attr.bmtime = bmtime
    if (metadata) attr.metadata = metadata
    if (bname) attr.bname
    if (typeof archived === 'boolean') attr.archived = archived ? true : undefined
    if (typeof deleted === 'boolean') attr.deleted = deleted ? true : undefined
    xattr.get(target, 'user.fruitmix', (err, xa) => { // FIXME: ERACE
      if (err) return callback(xa)
      try {
        xa = JSON.parse(xa)
      } catch(e) {
        return callback(Object.assign(e, { xcode: 'EXATTR' }))
      }
      Object.assign(xa, attr)
      
      if (deleted) {
        rimraf(target, err => {
          if(err) return callback(err)
          mkdirp(target, err => {
            if(err) return callback(err)
            xattr.set(target, 'user.fruitmix', JSON.stringify(xa), err => {
              return err ? callback(err) : callback(null, xa)
            })
          })
        })
      } else {
        xattr.set(target, 'user.fruitmix', JSON.stringify(xa), err => {
          return err ? callback(err) : callback(null, xa)
        })
      }
    })
  }

  updateFileAttr(dirPath, hash, fileUUID, props, callback) {
    let { bctime, bmtime, bname, archived } = props || {}
    let attr = {}
    if (bctime) attr.bctime = bctime
    if (bmtime) attr.bmtime = bmtime
    if (bname) attr.bname
    if (typeof archived === 'boolean') attr.archived = archived ? true : undefined
    this.readFileAttrs(dirPath, hash, (err, attrs) => {
      if (err) return callback(err)
      let index = attrs.findIndex(x => x.uuid === fileUUID)
      if (index === -1) return callback(Object.assign(new Error('file not found')))
      let at = Object.assign({}, attrs[index])
      Object.assign(at, attr)
      attrs.splice(index, 1, at)
      let targetPath = path.join(dirPath,'.xattr.' + hash)
      this.write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, at))
    })
  }

  deleteFileAttr(dirPath, hash, fileUUID, callback) {
    this.readFileAttrs(dirPath, hash, (err, attrs) => {
      if (err) return callback(err)
      let index = attrs.findIndex(x => x.uuid === fileUUID)
      if (index === -1) return callback(Object.assign(new Error('file not found'), { code: 404 }))
      let attr = attrs[index]
      attrs.splice(index, 1)
      let targetPath = path.join(dirPath,'.xattr.' + hash)
      if (attrs.length === 0) {
        // delete file/ file attr
        return rimraf(targetPath, err => {
          if (err) return callback(err) // delete attr file
          rimraf(path.join(dirPath, hash), err => err ? callback(err) : callback(null, attr))
        })
      } else 
        return this.write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, attr))
    })
  }

  createDir(target, attrs, callback) {
    let { uuid, metadata, bctime, bmtime, bname } = attrs
    let f =  cb => {
      let tmpDir = this.TMPFILE()
      fs.mkdir(tmpDir, err => {
        if (err) return cb(err)
        forceXstat(tmpDir, { uuid, metadata, bctime, bmtime, bname }, err => {
          if (err) return cb(err)
          fs.rename(tmpDir, target, err => err ? cb(err) : cb(null, xstat))
        })
      })
    }

    f((err, xstat) => {
      if (err && err.code === 'ENOTEMPTY') { // dir
        xattr.get(target, 'user.fruitmix', (err, xa) => {
          if (err) return callback(err)
          try {
            xa = JSON.parse(xa)
          } catch(e) {
            return callback(Object.assign(e, { xcode: 'EXATTR' }))
          }
          Object.assign(xa, { uuid, metadata, bctime, bmtime, archived: undefined }) // FIXME: archice all sibling?
          xattr.set(target, 'user.fruitmix', JSON.stringify(xa), err => {
            return err ? callback(err) : callback(null, xa)
          })
        })
      } else if (err) { // TODO: ENOTDIR (rename dir to place where already has a file named)
        callback(err)
      } else {
        callback(null, xstat)
      }
    })
  }

  createFile (tmp, dirPath, hash, attrs, callback) {
    let { uuid, archived, bctime, bmtime, fingerprint, bname } = attrs
    let target = path.join(dirPath, hash)
    fs.link(tmp, target, err => {
      if (!err || (err && err.code === 'EEXIST')) {
        // ignore EEXIST error
        let attr = { uuid, archived, bname, bctime, bmtime, fingerprint }
        this.createFileAttr(dirPath, hash, attr, callback)
      } else {
        callback(err)
      }
    })
  }

  createFileAttr (dirPath, hash, props, callback) {

    let { uuid, archived, bname, bctime, bmtime, fingerprint } = props || {}

    let targetPath = path.join(dirPath,'.xattr.' + hash)

    if (uuid && !isUUID(uuid))
      return process.nextTick(() => callback(EINVAL('invalid uuid')))
  
    uuid = uuid || UUID.v4()
  
    if (hash && !isSHA256(hash))
      return process.nextTick(() => callback(EINVAL('invalid hash')))
    if (fingerprint && !isSHA256(fingerprint))
      return process.nextTick(() => callback(EINVAL('invalid fingerprint')))
  
    if ((archived !== undefined && archived !== true))
      return process.nextTick(() => callback(EINVAL('invalid archived')))
    if (bname && !isNonEmptyString(bname)) 
      return process.nextTick(() => callback(EINVAL('invalid bname')))
    if (bctime && !Number.isInteger(bctime))
      return process.nextTick(() => callback(EINVAL('invalid bctime')))
    if (bmtime && !Number.isInteger(bmtime))
      return process.nextTick(() => callback(EINVAL('invalid bmtime')))

    fs.lstat(targetPath, (err, stat) => {
      if (err && err.code === 'ENOENT') {
        let attrs = [{ uuid, archived, bname, bctime, bmtime, fingerprint }]
        this.write(attrs, targetPath, true, null, err => {
          if (err && err.code === 'EEXIST') {
            this.createFileAttr(dirPath, hash, props, callback) // race, retry
          } else if (err) {
            callback(err)
          } else
            callback(null, null)
        })
      } else if (err) {
        callback(err)
      } else {
        let mtime = stat.mtime.getTime()
        this.readFileAttrs(dirPath, hash, (err, data) => {
          if (err) return callback(err)
          let attr = { uuid, archived, bname, bctime, bmtime, fingerprint }
          if (Array.isArray(data)) {
            data.push(attr)
            this.write(data, targetPath, false, mtime, err => err ? callback(err) : callback(null, attr))
          } else {
            throw new Error('File Attr Not Array')
          }
        })
      }
    })
  }

  readFileAttrs (dirPath, hash, callback) {
    let targetPath = path.join(dirPath,'.xattr.' + hash)
    fs.readFile(targetPath, (err, data) => {
      if (err) return callback(err)
      let attr
      try {
        attr = JSON.parse(data)
      } catch(e) {
        return callback(e)
      }
      callback(null, attr)
    })
  }

  readFileAttr (dirPath, hash, fileUUID, callback) {
    this.readFileAttrs(dirPath, hash, (err, attrs) => {
      if (err) return callback(err)
      let index = attrs.findIndex(x => x.uuid === fileUUID)
      if (index === -1) return callback(Object.assign(new Error('file not found'), { code: 404 }))
      let attr = Object.assign({}, attrs[index])
      return callback(null, attr)
    })
  }

  readWhiteout (dirPath, callback) {
    let targetPath = path.join(dirPath,'.xattr.' + WO_UUID)
    fs.readFile(targetPath, (err, data) => {
      if (err) return callback(err)
      let attr
      try {
        attr = JSON.parse(data)
      } catch(e) {
        return callback(e)
      }
      callback(null, attr)
    })
  }

  createWhiteout (dirPath, props, callback) {
    let targetPath = path.join(dirPath,'.xattr.' + WO_UUID)
    fs.lstat(targetPath, (err, stat) => {
      if (err && err.code === 'ENOENT') {
        let attrs = [props]
        this.write(attrs, targetPath, true, null, err => {
          if (err && err.code === 'EEXIST') {
            this.createWhiteout(dirPath, props, callback) // race, retry
          } else if (err) {
            callback(err)
          } else
            callback(null, null)
        })
      } else if (err) {
        callback(err)
      } else {
        let mtime = stat.mtime.getTime()
        this.readWhiteout(dirPath, (err, data) => {
          if (err) return callback(err)
          if (Array.isArray(data)) {
            data.push(props)
            this.write(data, targetPath, false, mtime, err => err ? callback(err) : callback(null, props))
          } else {
            throw new Error('File Attr Not Array')
          }
        })
      }
    })
  }

  write (data, target, hardLink, mtime, callback) {
    let tmpFile = this.vfs.TMPFILE()
    fs.writeFile(tmpFile, JSON.stringify(data, null, '  '), err => err
      ? callback(err)
      : hardLink ? fs.link(tmpFile, target, callback) 
        : fs.rename(tmpFile, target, callback))
  }
}

module.exports = BACKUP