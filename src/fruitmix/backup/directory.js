const Directory = require('../vfs/directory')
const File = require('./file')
const readdir = require('./readdir')
const debug = require('debug')('ws:backup-dir')

class Reading extends Directory.prototype.Reading {
  
  restart () {
    if (this.readdir) this.readdir.destroy()

    let dirPath = this.dir.abspath()
    let uuid = this.dir.uuid

    // when _mtime is null, read xstats forcefully
    let _mtime = this.callbacks.length === 0 ? this.dir.mtime : null

    // debug('breaddir', dirPath, uuid, _mtime)

    this.readdir = readdir(dirPath, uuid, _mtime, (err, obj, mtime, transient) => {
      // change to debug
      debug('breaddir done', err || (obj && obj.living ? obj.living.length : obj.living), mtime, transient)
      
      let xstats, whiteout

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
      } else if (obj.living) {

        xstats = obj.living
        whiteout = obj.whiteout
        /**
        Don't bypass update children! Do it anyway. Node.js fs timestamp resolution is not adequate.
        */
        this.updateChildren(xstats)
        if (mtime !== this.dir.mtime && !transient) {
          this.dir.mtime = mtime
        }

        if (transient) this.readn(1000)
      }
      this.callbacks.forEach(callback => callback(err, xstats, whiteout))
      if (Array.isArray(this.pending)) { // stay in working
        this.enter(this.pending)
      } else {
        this.exit()
        if (typeof this.pending === 'number') {
          this.setState('Pending', this.pending)
        } else if (xstats && transient) {
          this.setState('Pending', 500)
        } else {
          this.setState('Idle')
        }
      }
    })
  }

  /**
  This is the ONLY place updating in-memory fs object tree.
  */
  updateChildren (xstats) {
    // total
    this.dir.dirCount = xstats.filter(x => x.type === 'directory').length
    this.dir.fileCount = xstats.filter(x => x.type === 'file').length
    this.dir.fileSize = xstats.filter(x => x.type === 'file').reduce((acc, f) => acc + f.size, 0)

    // keep all file names
    this.dir.unindexedFiles = xstats
      .filter(x => x.type === 'file' && !x.metadata && !x.tags)
      .map(x => x.bname || x.name)
      .sort()

    // remove non-interested files
    // xstats = xstats.filter(x => x.type === 'directory' || (x.type === 'file' && (typeof x.magic === 'string' || (Array.isArray(x.tags) && x.tags.length !== 0))))
    xstats = xstats.filter(x => x.type === 'directory' || (x.type === 'file' && (x.metadata || x.tags)))

    // convert to a map
    let map = new Map(xstats.map(x => [x.uuid, x]))

    // update found child, remove found out of map, then destroy lost
    let dup = Array.from(this.dir.children)

    let lost = dup.reduce((arr, child) => {
      let xstat = map.get(child.uuid)
      if (xstat) {
        if (child instanceof File) {
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

    // create new
    map.forEach(x => x.type === 'file'
      ? new File(this.dir.ctx, this.dir, x)
      : new BDirectory(this.dir.ctx, this.dir, x))
  }
}

class BDirectory extends Directory {

  constructor(ctx, parent, xstat) {
    super(ctx, parent, xstat)

    this.archived = xstat.archived
    this.deleted = xstat.deleted
    this.metadata = xstat.metadata
    this.bctime = xstat.bctime
    this.bmtime = xstat.bmtime
  }
  
}

BDirectory.prototype.Reading = Reading

module.exports = BDirectory