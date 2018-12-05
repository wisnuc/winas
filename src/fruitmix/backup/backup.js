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
          return fileAttr.updateFileAttr(dir.abspath(), hash, fileUUID, { archived: true }, callback)
        } else {
          return callback(new Error('archive file must fileUUID && hash'))
        }
      }
      //dir
      return fileAttr.updateDirAttr(path.join(dir.abspath(), name), { archived: true }, callback)
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
          return fileAttr.updateFileAttr(dir.abspath(), hash, fileUUID, { archived: false }, callback)
        } else {
          return callback(new Error('archive file must fileUUID && hash'))
        }
      }
      //dir
      return fileAttr.updateDirAttr(path.join(dir.abspath(), name), { archived: false }, callback)
    })
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
          return fileAttr.deleteFileAttr(dir.abspath(), hash, fileUUID, (err, fattr) => {
            if (err) return callback(err)
            return fileAttr.createWhiteout(dir.abspath(), Object.assign(fattr, { hash }), callback)
          })
        } else {
          return callback(new Error('delete file must fileUUID && hash'))
        }
      } else
        return fileAttr.updateDirAttr(path.join(dir.abspath(), name), { deleted: true }, callback)
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
      fileAttr.createDir(target, { metadata, uuid, bctime, bmtime, bname:name, archived }, callback)
    })
  }

  newfile(user, props, callback){
    let { driveUUID, sha256, data } = props
    let drive = this.vfs.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      fileAttr.createFile(data, dir.abspath(), sha256, props, (err, data) => {
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
      fileAttr.updateFileAttr(dir.abspath(), hash, fileUUID, props, callback)
    })
  }

  updateDir(user, props, callback) {
    this.vfs.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.root().uuid !== dir.uuid) delete props.metadata // not support
      fileAttr.updateDirAttr(path.join(dir.abspath(), props.name), props, callback)
    })
  }

  append() {}
}

module.exports = BACKUP