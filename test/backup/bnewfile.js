const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')

const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const UUID = require('uuid')
const xattr = require('fs-xattr')

const chai = require('chai').use(require('chai-as-promised'))
const expect = chai.expect
const should = chai.should()

const App = require('src/app/App')
const Fruitmix = require('src/fruitmix/Fruitmix')
const { IDS, FILES, createReq, createToken } = require('./lib')
const createBigFileAsync = Promise.promisify(require('src/utils/createBigFile'))

const cwd = process.cwd()
const tmptest = path.join(cwd, 'tmptest')
const tmpDir = path.join(cwd, 'tmp')

const createApp = (users, drives, callback) => {
  rimraf.sync(tmptest)
  mkdirp.sync(tmptest)

  let tmpPath = path.join(tmptest, UUID.v4())
  fs.writeFileSync(tmpPath, JSON.stringify(users, null, ' '))
  fs.renameSync(tmpPath, path.join(tmptest, 'users.json'))

  tmpPath = path.join(tmptest, UUID.v4())
  fs.writeFileSync(tmpPath, JSON.stringify(drives, null, ' '))
  fs.renameSync(tmpPath, path.join(tmptest, 'drives.json'))

  fruitmix = new Fruitmix({
    fruitmixDir: tmptest,
    cloudConf: {}
  })

  let app = new App({
    fruitmix
  })

  fruitmix.on('FruitmixStarted', () => callback(null, app))
}

const createAppAsync = Promise.promisify(createApp)

let backup = Object.assign({}, IDS.backup)
describe('backup newfile', async () => {
  let app, token, REQ
  beforeEach(async () => {
    let users = [ IDS.alice ]
    backup.owner = IDS.alice.uuid
    let drives = [backup]
    app = await createAppAsync(users, drives)
    token = createToken('alice')
    REQ = createReq.bind({}, app.express, token)
    await Promise.delay(500)
  })

  const createBPDirAsync = async (driveUUID, dirUUID, dirname) => {
    let res = await REQ(`/drives/${driveUUID}/dirs/${dirUUID}/entries`, 'post')
      .field(dirname, JSON.stringify({ op: 'mkdir' }))
      .expect(200)
    expect(res.body).to.be.an('array').that.length(1)
    let data = res.body[0].data
    expect(data.bname).to.equal(dirname)
    expect(data.uuid).to.be.not.empty
    let path = app.fruitmix.vfs.forest.uuidMap.get(data.uuid).abspath()
    let attr = JSON.parse(xattr.getSync(path, 'user.fruitmix'))
    expect(attr.bname).to.equal(dirname)
    expect(attr.uuid).to.be.deep.equal(data.uuid)  
    return data
  }

  const NewFile2 = (driveUUID, dirUUID, name, file, fingerprint, overwrite, code, cb) => {
    REQ(`/drives/${driveUUID}/dirs/${dirUUID}/entries`, 'post')
    .attach(name, file.path, JSON.stringify({
      op: 'newfile',
      size: file.size,
      sha256: file.hash,
      fingerprint,
      bctime: 1555555,
      bmtime: 22555,
      overwrite: overwrite || undefined
    }))
    .expect(code)
    .end((err, res) => {
      if (err) return cb(err)
      cb(null, res)
    })
  }

  const Append2 = (driveUUID, dirUUID, name, file, append, fingerprint, code, cb) => {
    REQ(`/drives/${driveUUID}/dirs/${dirUUID}/entries`, 'post')
      .attach(name, file.path, JSON.stringify({
        op: 'append',
        size: file.size,
        sha256: file.hash,
        fingerprint,
        bctime: 1555555,
        bmtime: 22555,
        hash: append
      }))
      .expect(code)
      .end((err, res) => {
        if (err) return cb(err)
        cb(null, res)
      })
  }

  it('make top dir with metadata return 200', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
  })

  it('delete top dir force deleted return 200', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    await REQ(`/drives/${backup.uuid}/dirs/${backup.uuid}/entries`, 'post')
      .field(data.name, JSON.stringify({ op: 'remove' }))
      .expect(200)
    let res =  await REQ(`/drives/${backup.uuid}/dirs/${backup.uuid}`, 'get').expect(200)
    expect(res.body.entries).to.be.an('array').that.is.empty
  })

  it('create second dir return 200', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    let res =  await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}`, 'get').expect(200)
    expect(res.body.entries).to.be.an('array').and.to.have.lengthOf(1)
    let worlde = res.body.entries[0]
    expect(worlde).to.deep.equal({
      bname: 'world',
      mtime: worlde.mtime,
      name: 'world',
      type: 'directory',
      uuid: world.uuid,
      otime: worlde.otime
    })
  })

  it('upload file1', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .expect(200)
  })

  it('upload file * 5', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .expect(200)
    res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
    expect(res.body.entries).to.be.an('array').and.lengthOf(5)
  })

  it('upload file in rootdir', async () => {
    await REQ(`/drives/${backup.uuid}/dirs/${backup.uuid}/entries`, 'post')
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach('1', FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach('2', FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .attach('3', FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .expect(200)
    res =  await REQ(`/drives/${backup.uuid}/dirs/${backup.uuid}`, 'get').expect(200)
    expect(res.body.entries).to.be.an('array').and.lengthOf(5)
  })

  it('upload file * 800', async function () {
    this.timeout(0)
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    let q =  REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
    for (let i = 0; i < 800; i ++ ){
      q.attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
    }
    await q.expect(200)
    res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
    expect(res.body.entries).to.be.an('array').and.lengthOf(800)
  })

  describe('test archived', () => {
    let data, world, res, file
    beforeEach(async function() {
      data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
      expect(data.uuid).to.equal(data.name)
      world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
      expect(world.name).to.equal('world')
      res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
        .expect(200)
      file = res.body[0].data
    })

    it('upload file1 then archive it and reupload', async () => {
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .field(FILES.alonzo.name, JSON.stringify({ op:'updateAttr', uuid: file.uuid, hash: file.hash, archived: true }))
        .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
        .expect(200)
      res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      expect(res.body.entries).to.be.an('array').and.lengthOf(2)
      expect(res.body.entries.find(x => x.uuid === file.uuid).archived).to.be.true
    })
  
    it('archive file1', async () => {
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .field(FILES.alonzo.name, JSON.stringify({ op:'updateAttr', uuid: file.uuid, hash: file.hash, archived: true }))
        .expect(200)
    })
  
    it('archive dir2', async () => {
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .field(FILES.alonzo.name, JSON.stringify({ op:'updateAttr', uuid: file.uuid, hash: file.hash, archived: true }))
        .expect(200)
      await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}/entries`, 'post')
        .field(world.name, JSON.stringify({ op:'updateAttr', archived: true }))
        .expect(200)
    })
  })

  describe('test append', () => {

    beforeEach(async function (){
      this.timeout(0)
      try {
        rimraf.sync('test-files')
        await fs.lstatAsync('test-files')
      } catch (e) {
        if (e.code !== 'ENOENT') throw e
      }
      await mkdirpAsync('test-files')
      process.stdout.write('      creating big files')
      await createBigFileAsync(path.join(process.cwd(), 'test-files', 'one-giga'), 1024 * 1024 * 1024, '')
      process.stdout.write('...done\n')
    })

    it.skip('append return 200', async function() {
      this.timeout(0)
      let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
      expect(data.uuid).to.equal(data.name)
      let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
      expect(world.name).to.equal('world')
      await Promise.promisify(NewFile2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga, FILES.fiveGiga.hash, null, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.oneGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.twoGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.threeGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.fourGiga.hash, FILES.fiveGiga.hash, 200)
      let res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      expect(res.body.entries).to.be.an('array').and.to.have.lengthOf(5)
      let hashs = [FILES.oneGiga.hash, FILES.twoGiga.hash, FILES.threeGiga.hash, FILES.fourGiga.hash, FILES.fiveGiga.hash].sort()
      expect(res.body.entries.map(x => x.hash).sort()).to.deep.equal(hashs)
      let final = res.body.entries.find(x => !x.fingerprint)
      expect(final.hash).to.equal(FILES.fiveGiga.hash)
      expect(final).to.not.haveOwnProperty('fingerprint')
      let dir = app.fruitmix.vfs.forest.uuidMap.get(world.uuid)
      expect(dir.unindexedFiles).to.be.deep.equal([ final.name ])
    })

    it('remove final file should clean intermediate', async function() {
      this.timeout(0)
      let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
      expect(data.uuid).to.equal(data.name)
      let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
      expect(world.name).to.equal('world')
      await Promise.promisify(NewFile2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga, FILES.fiveGiga.hash, null, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.oneGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.twoGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.threeGiga.hash, FILES.fiveGiga.hash, 200)
      await Promise.promisify(Append2)(backup.uuid, world.uuid, 'five-giga', FILES.oneGiga,  FILES.fourGiga.hash, FILES.fiveGiga.hash, 200)
      let res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      let final = res.body.entries.find(x => !x.fingerprint)
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .field('five-giga', JSON.stringify({ op:'remove', hash: FILES.fiveGiga.hash, uuid: final.uuid }))
        .expect(200)
      res =  await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      expect(res.body.entries).to.be.an('array').and.lengthOf(1)
      expect(res.body.entries[0].deleted).to.be.true
    })
  })

  describe('test delete', () => {
    let data, world, res, files
    
    beforeEach(async function() {
      data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
      expect(data.uuid).to.equal(data.name)
      world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
      expect(world.name).to.equal('world')
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
        .attach(FILES.bar.name, FILES.bar.path, JSON.stringify({ op:'newfile', size:FILES.bar.size, sha256: FILES.bar.hash, bctime: 1555555, bmtime:155555 }))
        .attach(FILES.empty.name, FILES.empty.path, JSON.stringify({ op:'newfile', size:FILES.empty.size, sha256: FILES.empty.hash, bctime: 1555555, bmtime:155555 }))
        .expect(200)
      res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      files = res.body.entries
      expect(files).to.be.an('array').and.length(3)
    })

    it('delete bar', async () => {
      let bar = files.find(f => f.name === FILES.bar.name)
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .field(FILES.bar.name, JSON.stringify({ op:'remove', uuid: bar.uuid, hash: bar.hash }))
        .expect(200)
      res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      files = res.body.entries
      expect(files.find(x => x.uuid === bar.uuid).deleted).to.be.true
      files.every(f => expect(f.deleted).to.be[f.uuid === bar.uuid ? 'true' : 'undefined'])
    })

    it('delete all', async () => {
      let p = REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      files.forEach(f => p.field(f.name, JSON.stringify({ op:'remove', uuid: f.uuid, hash: f.hash })))
      await p.expect(200)
      res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}`, 'get').expect(200)
      files = res.body.entries
      expect(files).to.be.an('array').and.lengthOf(3)
      files.every(f => expect(f.deleted).to.be.true)
      files = fs.readdirSync(path.join(tmptest, 'drives', backup.uuid, data.name, world.name))
      expect(files).length(1)
      expect(files[0]).to.match(/.whiteout./)
    })

    it('delete world dir', async () => {
      await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}/entries`, 'post')
        .field(FILES.world.name, JSON.stringify({ op:'remove'}))
        .expect(200)
      res = await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}`, 'get').expect(200)
      files = res.body.entries
      expect(files).length(1)
      expect(files[0].deleted).to.be.true
      files = fs.readdirSync(path.join(tmptest, 'drives', backup.uuid, data.name, world.name))
      expect(files).length(0)
    })

    it('newfile to deleted dir return 400', async () => {
      await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}/entries`, 'post')
        .field(FILES.world.name, JSON.stringify({ op:'remove'}))
        .expect(200)
      await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
        .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
        .expect(400)
    })
  })
})
