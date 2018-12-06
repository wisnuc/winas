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
      let args = {  target: path.join(dir.abspath(), props.name), props }
      fileAttr.updateDirAttr(args, callback)
    })
  }

  append() {}
}

module.exports = BACKUP