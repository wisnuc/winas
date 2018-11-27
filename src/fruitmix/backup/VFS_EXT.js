const Promise = require('bluebird')
const fs = Promise.promisifyAll(require('fs'))
const xstatAsync = Promise.promisifyAll(require('../lib/xstat'))

module.exports = {

  async DIRAsync (user, props) {
    return Promise.promisify(this.DIR).bind(this)
  },

  isArchivedDir (dir) {
    do {
      if (dir.isArchived) return true
    } while(dir = dir.parent)
    return false
  },

  bNEWFILE (user, props, callback) {
    let { name, data, sha256, bctime, bmtime, driveUUID, fingerprint } = props
    let drive = this.drives.find(d => d.uuid === driveUUID)
    if (!drive || drive.isDeleted) return process.nextTick(() => callback(new Error('drive not found')))
    if (drive.type !== 'backup') return process.nextTick(() => callback(new Error('not backup dir')))
    this.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.deleted) return callback(Object.assign(new Error('dir not found'), { status: 404 }))
      let target = path.join(this.absolutePath(dir), sha256)
      forceXstat(data, {
        bfilename: name, bctime, bmtime, hash: sha256 || null, fingerprint
      }, (err, xstat) => {
        if (err) return callback(err)
        fs.rename(data, target, err => {
          if (err) return callback(err)
          return callback(null, xstat)
        })
      })
    })
  },

  bAPPEND (user, props, callback) {
    this.DIR(user, props, (err, dir) => {
      if (err) return callback(err) 
      let { name, hash, data, size, sha256 } = props
      let target = path.join(this.absolutePath(dir), hash)  
      readXstat(target, (err, xstat) => {
        if (err) {
          if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.xcode === 'EUNSUPPORTED') err.status = 403
          return callback(err)
        }

        if (xstat.type !== 'file') {
          let err = new Error('not a file')
          err.code = 'EISDIR'
          err.status = 403
          return callback(err)
        }

        if (xstat.size % (1024 * 1024 * 1024) !== 0) {
          let err = new Error('not a multiple of 1G')
          err.code = 'EALIGN' // kernel use EINVAL for non-alignment of sector size
          err.status = 403
          return callback(err)
        }

        if (xstat.hash !== hash) {
          let err = new Error(`hash mismatch, actual: ${xstat.hash}`)
          err.code = 'EHASHMISMATCH' 
          err.status = 403
          return callback(err)
        }

        let tmp = this.TMPFILE() 

        // concat target and data to a tmp file
        // TODO sync before op
        btrfsConcat(tmp, [target, data], err => {
          if (err) return callback(err)

          fs.lstat(target, (err, stat) => {
            if (err) return callback(err)
            if (stat.mtime.getTime() !== xstat.mtime) {
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

            // TODO preserve tags
            forceXstat(tmp, {
              uuid: xstat.uuid, 
              hash: xstat.size === 0 ? sha256 : combineHash(hash, sha256)
            }, (err, xstat2) => {
              if (err) return callback(err)

              // TODO dirty
              xstat2.name = name
              fs.rename(tmp, target, err => err ? callback(err) : callback(null, xstat2))
            })
          })
        })
      })
    })
  },

  bMKDIR (user, props, callback) {
    let { metadata } = props
    metadata = metadata || {}
    this.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      if (dir.deleted) return callback(Object.assign(new Error('dir not found'), { status: 404 }))
      let uuid = UUID.v4()
      let target = path.join(this.absolutePath(dir), uuid)
      metadata.name = props.name
      let tmpDir = this.TMPFILE()
      fs.mkdir(tmpDir, err => {
        if (err) return callback(err)
        forceXstat(tmpDir, { metadata, uuid }, (err, xstat) => {
          fs.rename(tmpDir, target, e ? callback(e) : callback(null, xstat))
        })
      })
    })
  },

  bARCHIVE (user, props, callback) {
    let { driveUUID } = props
    let specified = this.drives.find(d => d.uuid === driveUUID)
    if (!specified || specified.isDeleted || !this.userCanWriteDrive(user, specified) || specified.type !== 'backup') {
      let err = new Error('drive not found')
      err.status = 404
      return process.nextTick(() => callback(err))
    }
    this.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      let { name } = props
      let dstPath = path.join(this.absolutePath(dir), name)
      if (err) return callback(err)
      try {
        let attr = JSON.parse(xattr.getSync(dstPath, 'user.fruitmix'))
        attr.archived = true
        xattr.setSync(dstPath, 'user.fruitmix', JSON.stringify(attr))
        return dir.read(callback)
      } catch (e) { callback(e)}
    })
  },

  bDELETE (user, props, callback) {
    let { driveUUID } = props
    let specified = this.drives.find(d => d.uuid === driveUUID)
    if (!specified || specified.isDeleted || !this.userCanWriteDrive(user, specified) || specified.type !== 'backup') {
      let err = new Error('drive not found')
      err.status = 404
      return process.nextTick(() => callback(err))
    }
    this.DIR(user, props, (err, dir) => {
      if (err) return callback(err)
      let { name } = props
      let dstPath = path.join(this.absolutePath(dir), name)
      fs.lstat(dstPath, (err, stat) => {
        if (err) return callback(err)
        if (stat.isDirectory()) {
          let tmpDir = path.join(this.tmpDir, UUID.v4())
          try {
            mkdirp.sync(tmpDir)
            let attr = JSON.parse(xattr.getSync(dstPath, 'user.fruitmix'))
            attr.deleted = true
            xattr.setSync(tmpDir, 'user.fruitmix', JSON.stringify(attr))
            rimraf.sync(dstPath)
            child.execSync(`mv ${ tmpDir } ${ dstPath }`)
            return dir.read(callback)
          } catch (e) {
            return callback(e)
          }
        } else {
          try {
            let tmpFile = this.TMPFILE()
            fs.createWriteStream(tmpFile).end()
            let attr = JSON.parse(xattr.getSync(dstPath, 'user.fruitmix'))
            attr.deleted = true
            attr.hash = undefined
            xattr.setSync(tmpFile, 'user.fruitmix', JSON.stringify(attr))
            fs.renameSync(tmpFile, dstPath)
            return dir.read(callback)
          } catch (e) {
            return callback(e)
          }
        }
      })
    })
  },
}