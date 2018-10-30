const Promise = require('bluebird')
const path = require('path')
const fs = Promise.promisifyAll(require('fs'))
const EventEmitter = require('events')

const mkdirp = require('mkdirp')
const mkdirpAsync = Promise.promisify(mkdirp)
const rimraf = require('rimraf')
const rimrafAsync = Promise.promisify(rimraf)
const xattr = require('fs-xattr')

const chai = require('chai')
const expect = chai.expect

const MediaMap = require('src/media/map')
const VFS = require('src/vfs/vfs')

const xcopy = require('src/tasks/xcopy')

const cwd = process.cwd()
const tmptest = path.join(cwd, 'tmptest')
const rootUUID = '5c3571f7-c057-41e8-a4cb-489c5c3e2022' 


/**

single test includes:

ctx dir policy is null 

keep: if type match
replace: if type match
rename: irrelevent of type
skip: skip if type mismatch

keep, replace, rename, skip

1. dir -> null (all success, no conflict)
  1. 
    1 null, 2 replace, 3 rename, 4 skip

2. dir -> dir
  1
            2 replace, 3 rename, 4 skip
  null  (conflict, EEXIST + EISDIR)
    [replace,], [rename,], [skip,] should resolve
    [,replace], [,rename], [,skip] should NOT resolve

3. dir -> file
  1 replace, rename, skip
  null (conflict)
    [replace], [rename], [skip] should NOT resolve
    [,replace], [,rename], [,skip] should resolve

file -> null
  null, keep, replace, rename, skip
file -> file
  null, keep, replace, rename, skip
file -> dir
  null, keep, replace, rename, skip

**/

describe(path.basename(__filename) + ', cp a/c (dir) -> b/', () => {

  let vfs, mm, dirA, dirB, dirAC

  const f = (policies, callback) => {
    mm = new MediaMap()
    vfs = new VFS(tmptest, mm)
    vfs.createRoot(rootUUID, (err, root) => {
      vfs.once('DirReadDone', () => {
        dirA = vfs.findDirByName('a')
        dirB = vfs.findDirByName('b')
        dirAC = vfs.findDirByName('c', 'a')

        let src = { drive: rootUUID, dir: dirA.uuid }
        let dst = { drive: rootUUID, dir: dirB.uuid }
        let entries = [dirAC.uuid]
        xcopy(vfs, null, 'copy', policies, src, dst, entries, callback)
      })
    })
  }
  
  beforeEach(() => {
    rimraf.sync(tmptest)
    mkdirp.sync(path.join(tmptest, 'drives', rootUUID, 'a', 'c'))
    mkdirp.sync(path.join(tmptest, 'drives', rootUUID, 'b'))
  }) 

  

  it('OK if no policy, f9a4c2e5', done => f(null, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')

      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)

      // assert view? TODO
      done()
    })
  }))

  it('OK if [skip]', done => f({
    dir: ['skip']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if [,skip]', done => f({
    dir: [',skip']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if [replace]', done => f({
    dir: ['replace']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if [,replace]', done => f({
    dir: [,'replace']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if [rename]', done => f({
    dir: ['rename']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if [,rename]', done => f({
    dir: [,'rename']
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC = vfs.findDirByName('c', 'b')
      expect(dirBC.uuid).to.equal(attr.uuid)
      done()
    })
  }))

})

describe(path.basename(__filename) + ', cp a/c (dir) -> b/c (dir)', () => {

  let vfs, mm, dirA, dirB, dirAC, dirBC

  const f = (policies, callback) => {
    mm = new MediaMap()
    vfs = new VFS(tmptest, mm)
    vfs.createRoot(rootUUID, (err, root) => {
      vfs.once('DirReadDone', () => {
        dirA = vfs.findDirByName('a')
        dirB = vfs.findDirByName('b')
        dirAC = vfs.findDirByName('c', 'a')
        dirBC = vfs.findDirByName('c', 'b')

        let src = { drive: rootUUID, dir: dirA.uuid }
        let dst = { drive: rootUUID, dir: dirB.uuid }
        let entries = [dirAC.uuid]
        xcopy(vfs, src, dst, entries, policies, callback)
      })
    })
  }
  
  beforeEach(() => {
    rimraf.sync(tmptest)
    mkdirp.sync(path.join(tmptest, 'drives', rootUUID, 'a', 'c'))
    mkdirp.sync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'))
  }) 

  it('conflict, EEXIST + EISDIR if no policy', done => f(null, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // root state
      expect(xc.root.state.constructor.name).to.equal('Read')

      // child state
      let child = xc.root.children[0]
      expect(child.state.constructor.name).to.equal('Conflict')
      expect(child.state.err.code).to.equal('EEXIST')
      expect(child.state.err.xcode).to.equal('EISDIR')
      expect(child.state.policy).to.deep.equal([null, null])
      done()
    })
  }))

/**
  it('EEXIST + EISDIR if no policy', done => f(null, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // root state
      expect(xc.root.state.constructor.name).to.equal('Read')
      // child state
      let child = xc.root.children[0]
      expect(child.state.constructor.name).to.equal('Conflict')
      expect(child.state.err.code).to.equal('EEXIST')
      expect(child.state.err.xcode).to.equal('EISDIR')
      expect(child.state.policy).to.be.null
      done()
    })
  }))

  it('OK if replace', done => f({ 
    dir: { policy: 'replace', recursive: true } 
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC2 = vfs.findDirByName('c', 'b')
      expect(dirBC2.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if rename', done => f({ 
    dir: { policy: 'rename', recursive: true } 
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC2 = vfs.findDirByName('c', 'b')
      expect(dirBC2.uuid).to.equal(attr.uuid)
      done()
    })
  }))

  it('OK if skip', done => f({ 
    dir: { policy: 'skip', recursive: true } 
  }, (err, xc) => {
    if (err) return done(err)
    xc.once('stopped', () => {
      // assert state
      expect(xc.root.state.constructor.name).to.equal('Finished')
      // assert file system and vfs
      let attr = JSON.parse(xattr.getSync(path.join(tmptest, 'drives', rootUUID, 'b', 'c'), 'user.fruitmix'))
      let dirBC2 = vfs.findDirByName('c', 'b')
      expect(dirBC2.uuid).to.equal(attr.uuid)
      done()
    })
  }))
**/
})



