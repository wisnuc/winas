const fs = require('fs')
const path = require('path')
const UUID = require('uuid')

const fileAttr = require('./file-attr')

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
          let args = { dirPath: dir.abspath(), hash, fileUUID, props: { archived: true } }
          return fileAttr.updateFileAttr(args, callback)
        } else {
          return callback(new Error('archive file must fileUUID && hash'))
        }
      }
      //dir
      let args = { target: path.join(dir.abspath(), name), props: { archived: true } }
      return fileAttr.updateDirAttr(args, callback)
    })
  }

  // unarchive(user, props, callback) {
  //   let { hash, fileUUID, name, driveUUID } = props
  //   let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
  //   if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
  //   if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
  //   this.vfs.DIR(user, props, (err, dir) => {
  //     if (hash || fileUUID) {
  //       if (hash && fileUUID) { // file
  //         return fileAttr.updateFileAttr(dir.abspath(), hash, fileUUID, { archived: false }, callback)
  //       } else {
  //         return callback(new Error('archive file must fileUUID && hash'))
  //       }
  //     }
  //     //dir
  //     return fileAttr.updateDirAttr(path.join(dir.abspath(), name), { archived: false }, callback)
  //   })
  // }

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
          return fileAttr.deleteFileAttr(args, (err, fattr) => {
            if (err) return callback(err)
            args = { dirPath: dir.abspath(), props: Object.assign(fattr, { hash }) }
            return fileAttr.createWhiteout(args, callback)
          })
        } else {
          return callback(new Error('delete file must fileUUID && hash'))
        }
      } else {
        let args = { target: path.join(dir.abspath(), name), props: { deleted: true } }
        return fileAttr.updateDirAttr(args, callback)
      }
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
    let { metadata, bctime, bmtime, name, driveUUID, archived } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (archived && typeof archived !== 'boolean') return process.nextTick(() => callback(new Error('archived must type of boolean')))
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
      let target = path.join(dir.abspath(), dirname)
      let args = { target, attrs: { metadata, uuid, bctime, bmtime, bname:name, archived } }
      fileAttr.createDir(args, callback)
    })
  }

  newfile(user, props, callback){
    let { driveUUID, sha256, data } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      let args = { tmp: data, dirPath: dir.abspath(), hash: sha256, attrs: props }
      fileAttr.createFile(args, (err, data) => {
        if (err) return callback(err)
        return callback(null, Object.assign(data, { hash: sha256, name: props.name }))
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
  @param {object} user - user
  @param {object} props 
  @param {string} [driveUUID] - drive uuid
  @param {string} dirUUID - dir uuid
  @param {string} metadata - true or falsy
  @param {string} counter - true or falsy
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
        // backup add
        if (Array.isArray(whiteout)) {
          whiteout.forEach(w => entries.push(Object.assign({}, w, { deleted: true })))
        }
        callback(null, { path, entries })
      }
    })
  }

  append() {}
}

module.exports = BACKUP