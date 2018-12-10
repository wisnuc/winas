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
    fruitmixDir: tmptest
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
      uuid: world.uuid
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

  it('archive file1', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    let res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .expect(200)
    let file = res.body[0].data
    await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .field(FILES.alonzo.name, JSON.stringify({ op:'updateAttr', uuid: file.uuid, hash: file.hash, archived: true }))
      .expect(200)
  })

  it('archive dir2', async () => {
    let data = await createBPDirAsync(backup.uuid, backup.uuid, 'hello')
    expect(data.uuid).to.equal(data.name)
    let world = await createBPDirAsync(backup.uuid, data.uuid, 'world')
    expect(world.name).to.equal('world')
    let res = await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .attach(FILES.alonzo.name, FILES.alonzo.path, JSON.stringify({ op:'newfile', size:FILES.alonzo.size, sha256: FILES.alonzo.hash, bctime: 1555555, bmtime:155555 }))
      .expect(200)
    let file = res.body[0].data
    await REQ(`/drives/${backup.uuid}/dirs/${world.uuid}/entries`, 'post')
      .field(FILES.alonzo.name, JSON.stringify({ op:'updateAttr', uuid: file.uuid, hash: file.hash, archived: true }))
      .expect(200)
    await REQ(`/drives/${backup.uuid}/dirs/${data.uuid}/entries`, 'post')
      .field(world.name, JSON.stringify({ op:'updateAttr', archived: true }))
      .expect(200)
  })

  describe('test append', () => {

    before(async function (){
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

    it.only('append return 200', async function() {
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
  })  
})
