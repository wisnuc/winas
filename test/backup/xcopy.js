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
const driveDir = path.join(tmptest, 'drives')

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

let HOME = Object.assign({}, IDS.home)
describe('xcopy', async () => {
  let app, token, REQ, dir1UUID, dir2UUID, dir3UUID, dir4UUID, dir1, dir2, dir3, home
  before(async () => {
    let users = [ IDS.alice ]
    HOME.owner = IDS.alice.uuid
    let drives = [HOME]
    app = await createAppAsync(users, drives)
    token = createToken('alice')
    REQ = createReq.bind({}, app.express, token)
    await Promise.delay(500)

    await new Promise((resolve, reject) => {
      let dirUUID = HOME.uuid
      uploadTestFiles(token, HOME.uuid, dirUUID, ['dir1', 'dir2'], (err, res) => {
        if (err) {
          reject(err)
        } else {
          home = res.body
          dir1UUID = res.body.entries.find(x => x.name === 'dir1').uuid
          dir2UUID = res.body.entries.find(x => x.name === 'dir2').uuid
          uploadTestFiles(token, HOME.uuid, dir1UUID, ['dir3', 'dir4'], (err, res) => {
            if (err) {
              reject(err)
            } else {
              dir1 = res.body
              dir3UUID = res.body.entries.find(x => x.name === 'dir3').uuid
              dir4UUID = res.body.entries.find(x => x.name === 'dir4').uuid
              uploadTestFiles(token, HOME.uuid, dir3UUID, [], (err, res) => {
                if (err) {
                  reject(err)
                } else {
                  dir3 = res.body
                  resolve()
                }
              }) 
            }
          })
        }
      })
    })
  })

  const uploadTestFiles = (token, driveUUID, dirUUID, dirs, callback) => {
    let { alonzo, bar, empty, hello, world } = FILES
  
    let r = REQ(`/drives/${driveUUID}/dirs/${dirUUID}/entries`, 'post')
      .attach(alonzo.name, alonzo.path, JSON.stringify({
        size: alonzo.size,
        sha256: alonzo.hash,
        op: 'newfile'
      }))
      .attach(bar.name, bar.path, JSON.stringify({
        size: bar.size,
        sha256: bar.hash,
        op: 'newfile'
      }))
      .attach(empty.name, empty.path, JSON.stringify({
        size: empty.size,
        sha256: empty.hash,
        op: 'newfile'
      }))
      .attach(hello.name, hello.path, JSON.stringify({
        size: hello.size,
        sha256: hello.hash,
        op: 'newfile'
      }))
      .attach(world.name, world.path, JSON.stringify({
        size: world.size,
        sha256: world.hash,
        op: 'newfile'
      }))
      .attach(bar.name + 1, bar.path, JSON.stringify({
        size: bar.size,
        sha256: bar.hash,
        op: 'newfile'
      }))
      .attach(bar.name + 2, bar.path, JSON.stringify({
        size: bar.size,
        sha256: bar.hash,
        op: 'newfile'
      }))
      .attach(bar.name + 3, bar.path, JSON.stringify({
        size: bar.size,
        sha256: bar.hash,
        op: 'newfile'
      }))
  
    dirs.forEach(name => r.field(name, JSON.stringify({ op: 'mkdir' })))
  
    r.expect(200).end((err, res) => {
      if (err) return callback(err) 
  
      REQ(`/drives/${driveUUID}/dirs/${dirUUID}`, 'get')
        .expect(200)
        .end(callback)
    })
  }

  it("move alonzo in root into dir2, 2a47f5ac", async function () {
    await REQ(`/drives/${HOME.uuid}/dirs/${dir4UUID}`, 'get')
      .expect(200)
    this.timeout(0)
    let homeAlonzoUUID = home.entries.find(x => x.name === FILES.alonzo.name).uuid
    let res = await REQ('/tasks', 'post')
      .send({
        type: 'move',
        src: {
          drive: HOME.uuid,
          dir: HOME.uuid
        },
        dst: {
          drive: HOME.uuid,
          dir: dir2UUID
        },
        entries: [
          'dir1'
        ],
        policies: {
          dir: ['keep', null]
        }
      })
      .expect(200)

    let taskId = res.body.uuid

    while(true) {
      await Promise.delay(1000)
      res = await REQ(`/tasks/${taskId}`, 'get')
        .expect(200)
      if (res.body.finished) {
        console.log(res.body)
        break
      }
    }
    await REQ(`/drives/${HOME.uuid}/dirs/${dir4UUID}`, 'get')
      .expect(200)
    await REQ(`/drives/${HOME.uuid}/dirs/${dir1UUID}`, 'get')
      .expect(200)
  })

  it("get media", async function () {
    this.timeout(0)
    REQ(`/media/${FILES.alonzo.hash}?width=200&height=200&colors=16&alt=thumbnail`, 'get')
      .expect(200)
      .pipe(fs.createWriteStream('hahahahaha'))
      REQ(`/media/${FILES.alonzo.hash}?width=200&height=200&alt=thumbnail`, 'get')
      .expect(200)
      .pipe(fs.createWriteStream('hahahahah2a'))

  })

  /*
  for (let i = 0; i < 4; i ++) {
    it("move alonzo in root into dir2, 2a47f5ac", async function () {
      await REQ(`/drives/${HOME.uuid}/dirs/${dir4UUID}`, 'get')
        .expect(200)
      this.timeout(0)

      console.log(app.fruitmix.vfs.forest.timedFiles.array.map(x => [x.name, x.uuid]))
      let homeAlonzoUUID = home.entries.find(x => x.name === FILES.alonzo.name).uuid
      let res = await REQ('/tasks', 'post')
        .send({
          type: 'move',
          src: {
            drive: HOME.uuid,
            dir: dir1UUID
          },
          dst: {
            drive: HOME.uuid,
            dir: dir4UUID
          },
          entries: [
            '1.pdf' + (!i ? '' : i),
          ],
          policies: {
            dir: ['keep', null]
          }
        })
        .expect(200)
  
      let taskId = res.body.uuid
  
      while(true) {
        await Promise.delay(1000)
        res = await REQ(`/tasks/${taskId}`, 'get')
          .expect(200)
        if (res.body.finished) {
          console.log(res.body)
          break
        }
      }

      console.log(app.fruitmix.vfs.forest.timedFiles.array.map(x => [x.name, x.uuid]))
      await REQ(`/drives/${HOME.uuid}/dirs/${dir4UUID}`, 'get')
        .expect(200)
      await REQ(`/drives/${HOME.uuid}/dirs/${dir1UUID}`, 'get')
        .expect(200)
    })
   }
   */
})