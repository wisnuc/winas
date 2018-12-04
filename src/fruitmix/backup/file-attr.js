const fs = require('fs')
const path = require('path')
const os = require('os')

const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const UUID = require('uuid')
const xattr = require('fs-xattr')
const { forceXstat } = require('../../lib/xstat')
const { isUUID, isSHA256, isNonEmptyString } = require('../../lib/assertion')
const EUnsupported = require('../../lib/unsupported-file')
const fileMeta = require('../../lib/file-meta')

const WO_UUID = '13d20466-9893-4835-a436-1d4b3a0e26f7'
const EINVAL = (message) => Object.assign(new Error(message), { code: 'EINVAL' })

const updateDirAttr = (target, props, callback) => {
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
//fix
const updateFileAttr = (dirPath, hash, fileUUID, props, callback) => {
  let { bctime, bmtime, bname, archived } = props || {}
  let attr = {}
  if (bctime) attr.bctime = bctime
  if (bmtime) attr.bmtime = bmtime
  if (bname) attr.bname
  if (typeof archived === 'boolean') attr.archived = archived ? true : undefined
  readFileAttrs(dirPath, hash, (err, attrs) => {
    if (err) return callback(err)
    let index = attrs.attrs.findIndex(x => x.uuid === fileUUID)
    if (index === -1) return callback(Object.assign(new Error('file not found')))
    let at = Object.assign({}, attrs.attrs[index])
    Object.assign(at, attr)
    if (!attrs.hasOwnProperty('metadata')) {
      fileMeta(path.join(dirPath, hash), (err, metadata) => {
        if (err) {
          callback(err)
        } else {
          attrs.metadata = metadata
          attrs.attrs.splice(index, 1, at)
          let targetPath = path.join(dirPath,'.xattr.' + hash)
          write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, at))
        }
      })
    } else {
      attrs.attrs.splice(index, 1, at)
      let targetPath = path.join(dirPath,'.xattr.' + hash)
      write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, at))
    }
  })
}
//fix
const deleteFileAttr = (dirPath, hash, fileUUID, callback) => {
  readFileAttrs(dirPath, hash, (err, attrs) => {
    if (err) return callback(err)
    let index = attrs.attrs.findIndex(x => x.uuid === fileUUID)
    if (index === -1) return callback(Object.assign(new Error('file not found'), { code: 404 }))
    let attr = attrs.attrs[index]
    attrs.attrs.splice(index, 1)
    let targetPath = path.join(dirPath,'.xattr.' + hash)
    if (attrs.attrs.length === 0) {
      // delete file/ file attr
      return rimraf(targetPath, err => {
        if (err) return callback(err) // delete attr file
        rimraf(path.join(dirPath, hash), err => err ? callback(err) : callback(null, attr))
      })
    } else 
      return write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, attr))
  })
}

const createDir = (target, attrs, callback) => {
  let { uuid, metadata, bctime, bmtime, bname } = attrs
  let f =  cb => {
    let tmpDir = path.join(os.tmpdir(), UUID.v4())
    fs.mkdir(tmpDir, err => {
      if (err) return cb(err)
      forceXstat(tmpDir, { uuid, metadata, bctime, bmtime, bname }, err => {
        if (err) return cb(err)
        fs.rename(tmpDir, target, err => err ? cb(err) : cb(null, { uuid, metadata, bctime, bmtime, bname }))
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
        let orig = {}
        if (metadata) orig.metadata = metadata
        if (bctime) orig.bctime = bctime
        if (bmtime) orig.bmtime = bmtime
        if (bname) orig.bname = bname
        orig.archived = undefined
        Object.assign(xa, orig) // FIXME: archice all sibling?
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
//fix
const createFile = (tmp, dirPath, hash, attrs, callback) => {
  let { uuid, archived, bctime, bmtime, fingerprint, bname } = attrs
  if (attrs.name && !bname) bname = attrs.name
  let target = path.join(dirPath, hash)
  fs.link(tmp, target, err => {
    if (!err || (err && err.code === 'EEXIST')) {
      // ignore EEXIST error
      let attr = { uuid, archived, bname, bctime, bmtime, fingerprint }
      createFileAttr(dirPath, hash, attr, callback)
    } else {
      callback(err)
    }
  })
}
//fix
const createFileAttr = (dirPath, hash, props, callback) => {

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
      let attrs = { attrs: [{ uuid, archived, bname, bctime, bmtime, fingerprint }] }
      write(attrs, targetPath, true, null, err => { // use hard link to skip rename race
        if (err && err.code === 'EEXIST') {
          createFileAttr(dirPath, hash, props, callback) // race, retry
        } else if (err) {
          callback(err)
        } else
          callback(null, { uuid, archived, bname, bctime, bmtime, fingerprint })
      })
    } else if (err) {
      callback(err)
    } else {
      let mtime = stat.mtime.getTime()
      readFileAttrs(dirPath, hash, (err, data) => {
        if (err) return callback(err)
        let attr = { uuid, archived, bname, bctime, bmtime, fingerprint }
        if (Array.isArray(data.attrs)) {
          data.attrs.push(attr)
          write(data, targetPath, false, mtime, err => err ? callback(err) : callback(null, attr))
        } else {
          throw new Error('File Attr Not Array')
        }
      })
    }
  })
}

const createWhiteout = (dirPath, props, callback) => {
  let targetPath = path.join(dirPath, '.whiteout.' + WO_UUID)
  fs.lstat(targetPath, (err, stat) => {
    if (err && err.code === 'ENOENT') {
      let attrs = [props]
      write(attrs, targetPath, true, null, err => {
        if (err && err.code === 'EEXIST') {
          createWhiteout(dirPath, props, callback) // race, retry
        } else if (err) {
          callback(err)
        } else
          callback(null, null)
      })
    } else if (err) {
      callback(err)
    } else {
      let mtime = stat.mtime.getTime()
      readWhiteout(dirPath, (err, data) => {
        if (err) return callback(err)
        if (Array.isArray(data)) {
          data.push(props)
          write(data, targetPath, false, mtime, err => err ? callback(err) : callback(null, props))
        } else {
          throw new Error('File Attr Not Array')
        }
      })
    }
  })
}
//fix
const createFileXstat = (target, stats, attr) => {
  let name = path.basename(target)
  let xstat = {
    uuid: attr.uuid,
    type: 'file',
    name,
    mtime: stats.mtime.getTime(),
    size: stats.size,
  }
  if (attr.hash) xstat.hash = attr.hash
  if (attr.tags) xstat.tags = attr.tags
  if (attr.metadata && attr.metadata.type !== '_') {
    let metadata = Object.assign({}, attr.metadata)
    delete metadata.ver
    xstat.metadata = metadata
  }

  if (attr.bname) {// replace name
    xstat.name = attr.bname
    xstat.bname = attr.bname
  } 
  if (attr.bctime) xstat.bctime = attr.bctime
  if (attr.bmtime) xstat.bmtime = attr.bmtime

  xstat.archived = attr.archived
  return xstat
}

//fix
const createFileXstats = (target, stats, attrs, metadata) => {
  let xstats = []
  attrs.forEach(a => {
    a.metadata = metadata
    xstats.push(createFileXstat(target, stats, a))})
  return xstats
}


/**
 * @param {*} dirPath 
 * @param {*} hash 
 * @param {object} callback 
 * @param {object} callback.attrs
 * @param {object} callback.attrs.metadata
 * @param {array} callback.attrs.attrs
 */
const readFileAttrs = (dirPath, hash, callback) => {
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

const readFileAttr = (dirPath, hash, fileUUID, callback) => {
  readFileAttrs(dirPath, hash, (err, attrs) => {
    if (err) return callback(err)
    let index = attrs.attrs.findIndex(x => x.uuid === fileUUID)
    if (index === -1) return callback(Object.assign(new Error('file not found'), { code: 404 }))
    let attr = Object.assign({}, attrs.attrs[index])
    return callback(null, attr)
  })
}

const updateFileMeta = (dirPath, hash, attrs, callback) => {
  fileMeta(path.join(dirPath, hash), (err, metadata) => {
    if (err) {
      callback(err)
    } else {
      attrs.metadata = metadata
      let targetPath = path.join(dirPath,'.xattr.' + hash)
      write(attrs, targetPath, false, null, err => err ? callback(err) : callback(null, attrs))
    }
  })
}
//fixed
const readFileXstats = (dirPath, hash, callback) => {
  fs.lstat(path.join(dirPath, hash), (err, stats) => {
    if (err) return callback(err)
    if (!stats.isDirectory() && !stats.isFile()) return callback(EUnsupported(stats))
    readFileAttrs(dirPath, hash, (err, attrs) => {
      if (err) return callback(err)
      if (!attrs.hasOwnProperty('metadata')) {
        updateFileMeta(dirPath, hash, attrs, (err, data) => {
          if (err) return callback(err)
          callback(null, createFileXstats(path.join(dirPath, hash), stats, data.attrs, data.metadata))
        })
      } else
        callback(null, createFileXstats(path.join(dirPath, hash), stats, attrs.attrs, attrs.metadata))
    })
  })
}

const readFileXstat = (dirPath, hash, fileUUID, callback) => {
  fs.lstat(path.join())
}

const readWhiteout = (dirPath, callback) => {
  let targetPath = path.join(dirPath,'.whiteout.' + WO_UUID)
  fs.readFile(targetPath, (err, data) => {
    if (err && err.code === 'ENOENT') return callback(null, [])
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

const write = (data, target, hardLink, mtime, callback) => {
  let tmpFile = path.join(os.tmpdir(), UUID.v4())
  fs.writeFile(tmpFile, JSON.stringify(data, null, '  '), err => err
    ? callback(err)
    : hardLink ? fs.link(tmpFile, target, callback) 
      : fs.rename(tmpFile, target, callback))
}

module.exports = {
  write,
  createDir,
  createFile,
  createFileAttr,
  createWhiteout,
  createFileXstat,
  createFileXstats,
  readFileAttr,
  readFileAttrs,
  readFileXstat,
  readFileXstats,
  readWhiteout,
  deleteFileAttr,
  updateDirAttr,
  updateFileAttr
}