
class DirApi {

  constructor(vfs) {
    this.vfs = vfs
  }

  LIST(user, props, callback) {
    let err = new Error('not implemented yet')
    err.status = 500
    process.nextTick(() => callback(err))
  }

  GET(user, props, callback) {
    //backup add
    if (this.vfs.isBackupDrive(props.driveUUID))
      return this.vfs.backup.dirGET(user, props, callback)
    //backup end
    this.vfs.dirGET(user, props, callback)
  }

  PATCH(user, props, callback) {
    this.vfs.dirFormat(user, props, callback)
  }
}

module.exports = DirApi
