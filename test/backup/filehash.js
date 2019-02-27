const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
const child = require('child_process')

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
let home = Object.assign({}, IDS.home)
describe('backup newfile', async () => {
  let app, token, REQ
  beforeEach(async () => {
    let users = [ IDS.alice ]
    backup.owner = IDS.alice.uuid
    home.owner = IDS.alice.uuid
    let drives = [backup, home]
    app = await createAppAsync(users, drives)
    token = createToken('alice')
    REQ = createReq.bind({}, app.express, token)
    await Promise.delay(500)
  })

  it('get home return 200', async () => {
    res = await REQ(`/drives/${IDS.home.uuid}/dirs/${IDS.home.uuid}`, 'get')
      .expect(200)
    console.log(res.body)
  })


  it('xxxxxxxxxx', async function (){
    this.timeout(0)
    res = await REQ(`/drives/${IDS.home.uuid}/dirs/${IDS.home.uuid}`, 'get')
      .expect(200)
    expect(res.body.entries.length).to.equals(0)
    child.execSync(`cp /home/jackyang/Downloads/out.avi /home/jackyang/Documents/winas/tmptest/drives/${IDS.home.uuid}`)

    res = await REQ(`/drives/${IDS.home.uuid}/dirs/${IDS.home.uuid}`, 'get')
      .expect(200)
    console.log(res.body)
    await Promise.delay(10000)

    res = await REQ(`/drives/${IDS.home.uuid}/dirs/${IDS.home.uuid}`, 'get')
      .expect(200)
    console.log(res.body)
  })
})