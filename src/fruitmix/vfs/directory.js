const path = require('path')
const fs = require('fs')
const assert = require('assert')
const crypto = require('crypto')

const mkdirp = require('mkdirp')
const UUID = require('uuid')
const rimraf = require('rimraf')

const Node = require('./node')
const File = require('./file')
const readdir = require('./readdir')
const { mkdir, mkfile, mvdir, mvfile, clone, send } = require('./underlying')
const { readXstat, forceXstat, updateFileTags } = require('../../lib/xstat')
const { btrfsConcat, btrfsClone, btrfsClone2 } = require('../../lib/btrfs')

const Debug = require('debug')
const debug = process.env.hasOwnProperty('DEBUG') ? Debug('directory') : () => {}

class Base {
  constructor (dir, ...args) {
    this.dir = dir
    dir.state = this
    this.enter(...args)
  }

  enter () {
  }

  exit () {
  }

  setState (nextState, ...args) {
    this.exit()
    let NextState = this.dir[nextState]
    new NextState(this.dir, ...args)
  }

  readi () {
    this.setState('Reading')
  }

  readn (delay) {
    this.setState('Pending', delay)
  }

  readc (callback) {
    this.setState('Reading', [callback])
  }

  destroy () {
    this.exit()
  }

  updateName (name) {
    this.dir.name = name
  }
}

class Idle extends Base {
  enter () {
    this.dir.ctx.dirEnterIdle(this.dir)
  }

  exit () {
    this.dir.ctx.dirExitIdle(this.dir)
  }
}

class Init extends Base {
  enter () {
    this.dir.ctx.dirEnterInit(this.dir)
    this.timer = -1
  }

  exit () {
    clearTimeout(this.timer)
    this.dir.ctx.dirExitInit(this.dir)
  }

  readn (delay) {
    assert(Number.isInteger(delay) && delay > 0)

    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.readi(), delay)
  }
}

class Pending extends Base {
  enter (delay) {
    assert(Number.isInteger(delay) && delay > 0)

    this.dir.ctx.dirEnterPending(this.dir)
    this.readn(delay)
  }

  exit () {
    clearTimeout(this.timer)
    this.dir.ctx.dirExitPending(this.dir)
  }

  readn (delay) {
    assert(Number.isInteger(delay) && delay > 0)

    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.readi(), delay)
  }
}

class Reading extends Base {
  enter (callbacks = []) {
    this.dir.ctx.dirEnterReading(this.dir)
    this.callbacks = callbacks
    this.pending = undefined
    this.readdir = null
    this.restart()
  }

  exit () {
    this.dir.ctx.dirExitReading(this.dir)
  }

  restart () {
    if (this.readdir) this.readdir.destroy()

    let dirPath = this.dir.abspath()
    let uuid = this.dir.uuid

    // when _mtime is null, read xstats forcefully
    let _mtime = this.callbacks.length === 0 ? this.dir.mtime : null

    debug('readdir', dirPath, uuid, _mtime)

    this.readdir = readdir(dirPath, uuid, _mtime, (err, xstats, mtime, transient) => {
      // change to debug
      debug('readdir done', err || (xstats ? xstats.length : xstats), mtime, transient)
      let dirty = false
      if (dirPath !== this.dir.abspath()) {
        err = new Error('path changed during readdir operation')
        err.code = 'EINTERRUPTED'
      }

      if (err) {
        err.status = 503
        const pathErrCodes = ['ENOENT', 'ENOTDIR', 'EINSTANCE', 'EINTERRUPTED']
        if (pathErrCodes.includes(err.code)) {
          if (this.dir.parent) {
            this.dir.parent.read()
          } else {
            this.readn(1000)
          }
        } else {
          console.log('readdir error', err.message)
          this.readn(1000)
        }
      } else if (xstats) {
        /**
        Don't bypass update children! Do it anyway. Node.js fs timestamp resolution is not adequate.
        */
        let xs = this.updateChildren(xstats)
        dirty = !(xs.length === xstats.length)
        xstats = xs
        if (mtime !== this.dir.mtime && !transient) {
          this.dir.mtime = mtime
        }

        if (transient) this.readn(1000)
      }

      this.callbacks.forEach(callback => callback(err, xstats))
      if (Array.isArray(this.pending)) { // stay in working
        this.enter(this.pending)
      } else {
        this.exit()
        if (typeof this.pending === 'number') {
          new Pending(this.dir, this.pending)
        } else if ((xstats && transient) || dirty) {
          new Pending(this.dir, 500)
        } else {
          new Idle(this.dir)
        }
      }
    })
  }

  /**
  This is the ONLY place updating in-memory fs object tree.
  */
  updateChildren (xstats) {
    let xs = [...xstats]
    // total
    this.dir.dirCount = xstats.filter(x => x.type === 'directory').length
    this.dir.fileCount = xstats.filter(x => x.type === 'file').length
    this.dir.fileSize = xstats.filter(x => x.type === 'file').reduce((acc, f) => acc + f.size, 0)

    // keep all file names
    this.dir.unindexedFiles = xstats
      .filter(x => x.type === 'file' && !x.metadata && !x.tags)
      .map(x => x.name)
      .sort()

    // remove non-interested files
    // xstats = xstats.filter(x => x.type === 'directory' || (x.type === 'file' && (typeof x.magic === 'string' || (Array.isArray(x.tags) && x.tags.length !== 0))))
    xstats = xstats.filter(x => x.type === 'directory' || (x.type === 'file' && (x.metadata || x.tags)))

    // convert to a map
    let map = new Map(xstats.map(x => [x.uuid, x]))

    // update found child, remove found out of map, then destroy lost
    let dup = Array.from(this.dir.children)
    let isEqualTags = (tags1, tags2) => {
      if (tags1 === tags2) return true
      if (tags1 === undefined || tags2 === undefined) return false
      if (tags1.reduce((acc, c) => tags2.includes(c) ? acc : [...acc, c], []).length) return false
      if (tags2.reduce((acc, c) => tags1.includes(c) ? acc : [...acc, c], []).length) return false
      return true
    }

    let lost = dup.reduce((arr, child) => {
      let xstat = map.get(child.uuid)
      if (xstat) {
        if (child instanceof File) {
          /**
          if (child.name === xstat.name && child.hash === xstat.hash && isEqualTags(child.tags, xstat.tags)) {
            // skip
          } else {
            // file update is too complex when magic/name/hash changed
            child.destroy(true)
            new File(this.dir.ctx, this.dir, xstat)
          }
**/
          if (child.name !== xstat.name || child.hash !== xstat.hash) {
            // if name or hash changed re-create it, this makes it simple to update indexing
            child.destroy(true)
            new File(this.dir.ctx, this.dir, xstat)
          } else {
            child.tags = xstat.tags
          }
        } else if (child instanceof Directory) {
          if (child.name !== xstat.name) child.updateName(xstat.name)
          if (child.mtime !== xstat.mtime) child.read()
        }
        map.delete(child.uuid)
      } else {
        arr.push(child)
      }
      return arr
    }, [])
    lost.forEach(c => c.destroy(true))

    // check race then notify race and create new
    map.forEach(x => {
      if (x.type === 'file') {
        let find = this.dir.ctx.fileMap.get(x.uuid)
        if (find) {
          find.parent && find.parent.read()
          return xs.splice(xs.findIndex(f => f === x), 1)
        }
        new File(this.dir.ctx, this.dir, x)
      } else {
        let find = this.dir.ctx.uuidMap.get(x.uuid)
        if (find) {
          find.parent && find.parent.read()
          return xs.splice(xs.findIndex(f => f === x), 1)
        }
        new Directory(this.dir.ctx, this.dir, x)
      }
    })
    // return unrace xstats
    return xs
  }

  /**
  Request immediate `read` on all ancestors along node path (exclusive).

  This function is not currently used
  */
  fixPath () {
    // ancestors (exclusive)
    let ancestors = []
    for (let n = this.dir.parent; n !== null; n = n.parent) ancestors.unshift(n)
    ancestors.forEach(n => n.read())
  }

  /**
  read immediately
  */
  readi () {
    if (!Array.isArray(this.pending)) this.pending = []
  }

  /**
  request a delayed read
  */
  readn (delay) {
    if (Array.isArray(this.pending)) {

    } else if (typeof this.pending === 'number') {
      this.pending = Math.min(this.pending, delay)
    } else {
      this.pending = delay
    }
  }

  /**
  read with callback
  */
  readc (callback) {
    if (Array.isArray(this.pending)) {
      this.pending.push(callback)
    } else {
      this.pending = [callback]
    }
  }

  /**
  */
  updateName (name) {
    super.updatename(name)
    this.restart() // TODO test root change?
  }

  /**
  */
  destroy () {
    let err = new Error('destroyed')
    err.code = 'EDESTROYED'
    this.callbacks.forEach(cb => cb(err))
    if (Array.isArray(this.pending)) this.pending.forEach(cb => cb(err))
    this.readdir.destroy()
    super.destroy()
  }
}

/**
Directory represents a directory in the underlying file system.

In this version, `children` contains only sub directories and files with interested type (magic is string).

Another change is the `Directory` should NOT be directly updated. Instead, external components MUST call `read` method after a file system operation finished.
*/
class Directory extends Node {
  /**
  @param {Forest} ctx
  @param {Directory} parent - parent `Directory` object
  @param {xstat} xstat
  */
  constructor (ctx, parent, xstat) {
    super(ctx, parent, xstat)

    this.children = []
    this.unindexedFiles = []

    this.uuid = xstat.uuid
    this.name = xstat.name
    this.mtime = -xstat.mtime

    this.fileSize = 0
    this.fileCount = 0
    this.dirCount = 0

    this.ctx.indexDirectory(this)
    new Init(this)
    // queue run function
    // function(done())
    this.taskQueue = []
  }

  /**
  Destructor
  */
  destroy (detach) {
    debug('destroying', this.uuid, this.name, !!detach)
    // why this does not work ???
    // [...this.children].forEach(child => child.destroy())
    Array.from(this.children).forEach(c => c.destroy())
    this.state.destroy()
    this.ctx.unindexDirectory(this)
    super.destroy(detach)

    debug('destroyed', this.uuid, this.name, !!detach)
  }

  /**
  Update name recursively
  */
  updateName (name) {
    debug('updateName', this.uuid, this.name)
    // update name first
    this.state.updateName(name)
    this.children.forEach(c => c.updateName())
  }

  /**
  Request a `state` operation.

  @param {(function|number)} [x] - may be a callback function or a number
  */
  read (x) {
    if (typeof x === 'function') {
      // console.log(this.state)
      this.state.readc(x)
    } else if (typeof x === 'number') {
      this.state.readn(x)
    } else {
      this.state.readi()
    }
  }

  readi () {
    this.state.readi()
  }

  readc (callback) {
    this.state.readc(callback)
  }

  readn (delay) {
    this.state.readn(delay)
  }

  /**
  Read xstats of the directory

  @returns {xstats[]}
  */
  async readdirAsync () {
    return new Promise((resolve, reject) =>
      this.readc((err, xstats) => err ? reject(err) : resolve(xstats)))
  }

  /**
  */
  nameWalk (names) {
    if (names.length === 0) return this
    let c = this.children.find(x => x instanceof Directory && x.name === names[0])
    if (!c) {
      return this
    } else {
      return c.nameWalk(names.slice(1))
    }
  }

  // this function is used by external components TODO who?
  // that operates on underlying file system
  // it should be called right after a readXstat is performed
  // this function returns Directory object
  updateDirChild (xstat) {
    let child = this.children.find(c => c.uuid === xstat.uuid)
    if (child) {
      if (child.name !== xstat.name) {
        child.updateName(name)
      } else {
        child.read()
      }
      return child
    } else {
      return new Directory(this.ctx, this, xstat)
    }
  }

  /**
  */
  iterate (itor, F) {

    const fileName = file => typeof file === 'object' ? file.name : file

    let dirs = this.children
      .filter(x => x instanceof Directory)
      .sort((a, b) => a.name.localeCompare(b.name))

    let indexedFiles = this.children
      .filter(x => x instanceof File)
      .sort((a, b) => a.name.localeCompare(b.name))

    let files = [...indexedFiles, ...this.unindexedFiles].sort((a, b) => {
      let a1 = typeof a === 'string' ? a : a.name
      let b1 = typeof b === 'string' ? b : b.name
      return a1.localeCompare(b1)
    })

    if (!itor) {
      if (F(this)) return true
      for (let i = 0; i < dirs.length; i++) { 
        if (dirs[i].iterate(null, F)) return true 
      }
      for (let i = 0; i < files.length; i++) { 
        if (F(files[i], this)) return true 
      }
    } else {
      let { type, namepath } = itor

      if (type !== 'directory' && type !== 'file') throw new Error('invalid type type')
      if (!Array.isArray(namepath)) throw new Error('invalid namepath type')

      if (namepath.length === 0) {
        if (type !== 'directory') throw new Error('invalid type')

        // bypass myself for exclusive (aka, I am the last one in previous search)
        for (let i = 0; i < dirs.length; i++) { 
          if (dirs[i].iterate(null, F)) return true 
        }
        for (let i = 0; i < files.length; i++) { 
          if (F(files[i], this)) return true 
        }
      } else if (namepath.length === 1) {
        let name = namepath[0]
        if (type === 'directory') {
          let index = dirs.findIndex(dir => name.localeCompare(dir.name) <= 0)
          if (index !== -1) {
            if (dirs[index].name === name) { // skip same for exclusive
              if (dirs[index].iterate({ namepath: [], type: 'directory' }, F)) return true
              for (let i = index + 1; i < dirs.length; i++) { 
                if (dirs[i].iterate(null, F)) return true 
              }
            } else {
              for (let i = index; i < dirs.length; i++) { 
                if (dirs[i].iterate(null, F)) return true 
              }
            }
          }
          for (let i = 0; i < files.length; i++) { 
            if (F(files[i], this)) return true 
          }
        } else {
          let index = files.findIndex(f => name.localeCompare(fileName(f)) <= 0)
          if (index !== -1) {
            if (name === fileName(files[index])) index++ // skip same for exclusive
            for (let i = index; i < files.length; i++) { 
              if (F(files[i], this)) return true 
            }
          }
        }
      } else {
        let name = namepath[0]
        let index = dirs.findIndex(dir => name.localeCompare(dir.name) <= 0)
        if (index !== -1) {
          if (name === dirs[index].name) { // found and enter
            if (dirs[index].iterate({ namepath: namepath.slice(1), type }, F)) return true
          } else {  // continue from next one
            for (let i = index; i < dirs.length; i++) {
              if (dirs[i].iterate(null, F)) return true
            }  

            for (let i = 0; i < files.length; i++) {
              if (F(files[i], this)) return true
            }
          }
        }
        
        for (let i = 0; i < files.length; i++) {
          if (F(files[i], this)) return true
        }
      }
    }
  }

  /**
  recursively stats directory
  */
  stats () {
    let dirCount = this.dirCount
    let fileCount = this.fileCount
    let fileTotalSize = this.fileSize

    if (this.children) {
      this.children.forEach(x => {
        if (x instanceof Directory) {
          let stats = x.stats()
          dirCount += stats.dirCount
          fileCount += stats.fileCount
          fileTotalSize += stats.fileTotalSize
        } 
      })
    } 

    return { dirCount, fileCount, fileTotalSize }
  }


  /***********************************************************/
  /***********************************************************/

  addTask(f) {
    this.taskQueue.push(f)
  }

  getTask() {
    return this.taskQueue.shift()
  }

  MKDIR({ name, policy, read }, cb) {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      const target = path.join(this.abspath(), name)
      mkdir(target, policy, (err, xstat, resolved) => {
        if (err) return callback(err)
        // this only happens when skip diff policy taking effect
        if (!xstat) return callback(null, null, resolved)
        if (!read) return callback(null, xstat, resolved)
        this.read((err, xstats) => {
          if (err) return callback(err)
          let found = xstats.find(x => x.uuid === xstat.uuid)
          if (!found) {
            let err = new Error(`failed to find newly created directory`)
            err.code = 'ENOENT'
            err.xcode = 'EDIRTY'
            callback(err)
          } else {
            callback(null, found, resolved)
          }
        })
      })
    }
    this.addTask(F)
  }

  RENAME(props, cb) {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let { fromName, toName, policy } = props
      policy = policy || [null, null]
      
      let src = path.join(this.abspath(), fromName) 
      let dst = path.join(this.abspath(), toName)
      readXstat(src, (err, srcXstat) => {
        if (err) return callback(err)
        if (srcXstat.type === 'directory') {
          mvdir(src, dst, policy, (err, xstat, resolved) => {
            if (err) return callback(err)
            this.read((err, xstats) => {
              if (err) return callback(err)
              return callback(null, xstat, resolved) 
            })
          })
        } else {
          mvfile(src, dst, policy, (err, xstat, resolved) => {
            if (err) return callback(err)
            this.read((err, xstats) => {
              if (err) return callback(err)
              return callback(null, xstat, resolved) 
            })
          })
        }
      })
    }
    this.addTask(F)
  }

  REMOVE(props, cb) {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let { name } = props 
      let target = path.join(this.abspath(), name)
      rimraf(target, err => callback(err))
    }
    this.addTask(F)
  }

  NEWFILE(props, cb) {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      if (!props.policy) props.policy = [null, null]
      let target = path.join(this.abspath(), props.name)
      mkfile(target, props.data, props.sha256 || null, props.policy, callback)
    }
    this.addTask(F)
  }

  TMPFILE() {
    return path.join(global.TMPDIR(), UUID.v4())
  }

  APPEND(props, cb) {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let { name, hash, data, size, sha256 } = props

      let target = path.join(this.abspath(), name)  
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
    }
    this.addTask(F)
  }

  ADDTAGS() {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let tags = Array.from(new Set(props.tags)).sort()   
      let filePath = path.join(this.abspath(), props.name)   

      readXstat(filePath, (err, xstat) => {
        if (err) return callback(err)
        if (xstat.type !== 'file') {
          let err = new Error('not a file')
          err.code = 'ENOTFILE'
          return callback(err)
        }

        let oldTags = xstat.tags || []
        let newTags = Array.from(new Set([...oldTags, ...tags])).sort()

        if (newTags.length === oldTags.length) {
          callback(null, xstat)
        } else {
          updateFileTags(filePath, xstat.uuid, newTags, callback)
        }
      })
    }
    this.addTask(F)
  }

  REMOVETAGS() {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let filePath = path.join(this.abspath(), props.name)
      readXstat(filePath, (err, xstat) => {
        if (err) return callback(err)
        if (xstat.type !== 'file') {
          let err = new Error('not a file')
          err.code = 'ENOTFILE'
          return callback(err)
        }

        if (!xstat.tags) return callback(null, xstat) 
        
        // complementary set
        let newTags = xstat.tags.reduce((acc, id) => tags.includes(id) ? acc : [...acc, id], [])
        console.log(newTags)
        updateFileTags(filePath, xstat.uuid, newTags, callback)
      }) 
    }
    this.addTask(F)
  }

  SETTAGS() {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
      let filePath = path.join(this.abspath(), props.name)
      readXstat(filePath, (err, xstat) => {
        if (err) return callback(err)  
        if (xstat.type !== 'file') {
          let err = new Error('not a file')
          err.code = 'ENOTFILE'
          return callback(err)
        }
        updateFileTags(filePath, xstat.uuid, tags, callback)
      })
    }
    this.addTask(F)
  }

  DIRFORMAT() {
    const F = (done) => {
      const callback = (...args) => (cb(...args), done())
    }
    this.addTask(F)
  }

}

Directory.prototype.Init = Init
Directory.prototype.Idle = Idle
Directory.prototype.Pending = Pending
Directory.prototype.Reading = Reading

module.exports = Directory
