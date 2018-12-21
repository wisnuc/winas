const fs = require('fs')
const path = require('path')

const Promise = require('bluebird')
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

const lock = new Map()

const FUNCS = {}

const call = (command, args, callback) => {
  let { target, dirPath, hash } = args
  let lockKey
  if (target) {
    lockKey = target
  } else if (dirPath && hash) {
    lockKey = path.join(dirPath, hash)
  } else if (dirPath) { // for create whiteout
    lockKey = path.join(dirPath, '.whiteout.')
  } else {
    return callback('invaild key for call')
  }
  let cb = (...args) => {
    let ops = lock.get(lockKey)
    ops.shift() // clean self
    if (ops.length) schedule(lockKey)
    else {
      lock.delete(lockKey)
    }
    process.nextTick(() => callback(...args))
  }
  if (lock.has(lockKey)) {
    lock.get(lockKey).push({ command, args, cb })
  } else {
    lock.set(lockKey, [{ command, args, cb }])
    schedule(lockKey)
  }
}

const schedule = (key) => {
  let ops = lock.get(key)
  if (!ops || !ops.length) throw new Error('lock error')
  let { command, args, cb } = ops[0]
  FUNCS[command](args, cb)
}

const updateDirAttr = ({ target, props }, callback) => {
  let { bctime, bmtime, metadata, bname, archived, deleted, forceDelete } = props || {}
  let attr = {}
  if (bctime) attr.bctime = bctime
  if (bmtime) attr.bmtime = bmtime
  if (metadata) attr.metadata = metadata
  attr.otime = new Date().getTime()
  // skip bname property update
  // if (bname) attr.bname 
  if (typeof archived === 'boolean') attr.archived = archived ? true : undefined
  else if (archived) return callback(new Error('archived must typeof boolean or undefined'))
  if (typeof deleted === 'boolean') attr.deleted = deleted ? true : undefined
  xattr.get(target, 'user.fruitmix', (err, xa) => {
    if (err) return callback(err)
    try {
      xa = JSON.parse(xa)
    } catch(e) {
      return callback(Object.assign(e, { xcode: 'EXATTR' }))
    }
    Object.assign(xa, attr)
    
    if (deleted) {
      rimraf(target, err => {
        if(err) return callback(err)
        if(forceDelete) return callback(null, xa)
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

FUNCS.updateDirAttr = updateDirAttr

const updateFileAttr = ({ dirPath, hash, fileUUID, props }, callback) => {
  let { bctime, bmtime, bname, archived, desc } = props || {}
  let attr = {}
  if (bname && !isNonEmptyString(bname)) 
    return process.nextTick(() => callback(EINVAL('invalid bname')))
  if (bctime && !Number.isInteger(bctime))
    return process.nextTick(() => callback(EINVAL('invalid bctime')))
  if (bmtime && !Number.isInteger(bmtime))
    return process.nextTick(() => callback(EINVAL('invalid bmtime')))
  if (desc && (!isNonEmptyString(desc) || desc.length > 140))
    return process.nextTick(() => callback(EINVAL('invalid desc')))
  if (typeof archived === 'boolean') attr.archived = archived ? true : undefined
  else if (archived) return callback(new Error('archived must typeof boolean or undefined'))
  
  if (bctime) attr.bctime = bctime
  if (bmtime) attr.bmtime = bmtime
  if (bname) attr.bname
  if (desc) attr.desc = desc
  attr.otime = new Date().getTime()
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

FUNCS.updateFileAttr = updateFileAttr

const deleteFileAttr = ({ dirPath, hash, fileUUID }, callback) => {
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

FUNCS.deleteFileAttr = deleteFileAttr

// bname can not update
const createDir = ({ target, attrs }, callback) => {
  let { uuid, metadata, bctime, bmtime, bname, deleted } = attrs
  if (typeof attrs.archived === 'boolean') attrs.archived = archived ? true : undefined // convert archived
  else if (attrs.archived) return callback(new Error('archived must typeof boolean or undefined'))
  let archived = attrs.archived
  let f =  cb => {
    let tmpDir = path.join(global.TMPDIR(), UUID.v4())
    fs.mkdir(tmpDir, err => {
      if (err) return cb(err)
      forceXstat(tmpDir, { uuid, metadata, bctime, bmtime, bname, archived, deleted, otime: new Date().getTime() }, (err, xstat) => {
        if (err) return cb(err)
        xstat.name = path.basename(target)
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
        let orig = {}
        orig.otime = new Date().getTime()
        if (metadata) orig.metadata = metadata
        if (bctime) orig.bctime = bctime
        if (bmtime) orig.bmtime = bmtime
        if (bname) orig.bname = bname
        if (attrs.hasOwnProperty('archived')) orig.archived = attrs.archived
        if (attrs.hasOwnProperty('deleted')) orig.deleted = attrs.deleted
        Object.assign(xa, orig)
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

FUNCS.createDir = createDir

const createFile = ({ tmp, dirPath, hash, attrs }, callback) => {
  let { uuid, archived, bctime, bmtime, fingerprint, bname, desc } = attrs
  if (attrs.name && !bname) bname = attrs.name
  if (hash === fingerprint) fingerprint = undefined // file upload complete
  if (typeof archived === 'boolean') archived = archived ? true : undefined
  else if (archived) return callback(new Error('archived must typeof boolean or undefined'))
  let target = path.join(dirPath, hash)
  fs.link(tmp, target, err => {
    rimraf(tmp, () => { // ignore error
      if (!err || (err && err.code === 'EEXIST')) {
        // ignore EEXIST error
        let attr = { uuid, archived, bname, bctime, bmtime, fingerprint, desc }
        createFileAttr({ dirPath, hash, props: attr }, callback)
      } else {
        callback(err)
      }
    })
  })
}

FUNCS.createFile = createFile

const createFileAttr = ({ dirPath, hash, props }, callback) => {

  let { uuid, archived, bname, bctime, bmtime, fingerprint, desc } = props || {}

  let targetPath = path.join(dirPath,'.xattr.' + hash)

  if (typeof archived === 'boolean') archived = archived ? true : undefined

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
  if (desc && (!isNonEmptyString(desc) || desc.length > 140))
    return process.nextTick(() => callback(EINVAL('invalid desc')))
  
  let orig = { uuid, archived, bname, bctime, bmtime, fingerprint, desc }
  orig.otime = new Date().getTime() // operation time
  fs.lstat(targetPath, (err, stat) => {
    if (err && err.code === 'ENOENT') {
      let attrs = { attrs: [orig] }
      write(attrs, targetPath, true, null, err => { // use hard link to skip rename race
        if (err && err.code === 'EEXIST') {
          createFileAttr({ dirPath, hash, props }, callback) // race, retry
        } else if (err) {
          callback(err)
        } else
          callback(null, orig)
      })
    } else if (err) {
      callback(err)
    } else {
      let mtime = stat.mtime.getTime()
      readFileAttrs(dirPath, hash, (err, data) => {
        if (err) return callback(err)
        if (Array.isArray(data.attrs)) {
          data.attrs.push(orig)
          write(data, targetPath, false, mtime, err => err ? callback(err) : callback(null, orig))
        } else {
          throw new Error('File Attr Not Array')
        }
      })
    }
  })
}

FUNCS.createFileAttr = createFileAttr

const createWhiteout = ({ dirPath, props }, callback) => {
  let targetPath = path.join(dirPath, '.whiteout.' + WO_UUID)
  props.otime = new Date().getTime() // operation time
  fs.lstat(targetPath, (err, stat) => {
    if (err && err.code === 'ENOENT') {
      let attrs = [props]
      write(attrs, targetPath, true, null, err => {
        if (err && err.code === 'EEXIST') {
          createWhiteout({ dirPath, props }, callback) // race, retry
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

FUNCS.createWhiteout = createWhiteout

const updateFileMeta = ({ dirPath, hash, attrs }, callback) => {
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

FUNCS.updateFileMeta = updateFileMeta

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
  if (attr.desc) xstat.desc = desc
  if (attr.bname) {
    xstat.name = attr.bname // replace name
    xstat.bname = attr.bname
  } 
  if (attr.bctime) xstat.bctime = attr.bctime
  if (attr.bmtime) xstat.bmtime = attr.bmtime
  if (attr.fingerprint) xstat.fingerprint = attr.fingerprint
  xstat.otime = attr.otime // operation time
  xstat.archived = attr.archived
  return xstat
}

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

const readFileXstats = (dirPath, hash, callback) => {
  fs.lstat(path.join(dirPath, hash), (err, stats) => {
    if (err) return callback(err)
    if (!stats.isFile()) return callback(EUnsupported(stats))
    readFileAttrs(dirPath, hash, (err, attrs) => {
      if (err) return callback(err)
      if (!attrs.hasOwnProperty('metadata')) {
        call('updateFileMeta', { dirPath, hash, attrs }, (err, data) => {
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
  let tmpFile = path.join(global.TMPDIR(), UUID.v4())
  fs.writeFile(tmpFile, JSON.stringify(data, null, '  '), err => err
    ? callback(err)
    : hardLink ? fs.link(tmpFile, target, callback) 
      : fs.rename(tmpFile, target, callback))
}

module.exports = {
  write,
  createFileXstat,
  createFileXstats,
  readFileAttr,
  readFileAttrs,
  readFileXstat,
  readFileXstats,
  readWhiteout,
  call
}

module.exports.COMMAND = {
  deleteFileAttr: 'deleteFileAttr',
  updateDirAttr: 'updateDirAttr',
  updateFileAttr: 'updateFileAttr',
  createDir: 'createDir',
  createFile: 'createFile',
  createFileAttr: 'createFileAttr',
  createWhiteout: 'createWhiteout'
}