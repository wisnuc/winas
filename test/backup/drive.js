const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')

const rimraf = require('rimraf')
const rimrafAsync = Promise.promisify(require('rimraf'))
const mkdirp = require('mkdirp')
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const UUID = require('uuid')
const request = require('supertest')
const JWT = require('jwt-simple')

const chai = require('chai').use(require('chai-as-promised'))
const sinon = require('sinon')
const expect = chai.expect
const should = chai.should()

const {
  IDS,
  createUserAsync,
  retrieveTokenAsync,
  createPublicDriveAsync
} = require('./lib')

const App = require('src/app/App')
const Fruitmix = require('src/fruitmix/Fruitmix')

const cwd = process.cwd()
const tmptest = path.join(cwd, 'tmptest')
const tmpDir = path.join(cwd, 'tmp')

let users = [
  {
    "uuid": "15b26868-3017-450a-8ce0-5692f86bdc67",
    "username": "18817301665",
    "isFirstUser": true,
    "smbPassword": "",
    "status": "ACTIVE",
    "winasUserId": "6947667a-f8ff-498c-b0cb-ebc4d97715d7"
  }
]


let token, app, fruitmix, drive, topdir, second, pngfile1, pngfile2, pdffile
rimraf.sync(tmptest)
mkdirp.sync(tmptest)
let tmpPath = path.join(tmptest, UUID.v4())
fs.writeFileSync(tmpPath, JSON.stringify(users, null, ' '))
fs.renameSync(tmpPath, path.join(tmptest, 'users.json'))
fruitmix = new Fruitmix({
  fruitmixDir: tmptest
})
app = new App({
  fruitmix,
  useServer: true
})
token = JWT.encode({
  uuid: users[0].uuid
}, 'Lord, we need a secret')
describe(path.basename(__filename) + ', Alice only', () => {

  beforeEach(async () => {
    await Promise.delay(1000)
  })
  
  it('Create Backup Drive, writelist [alice]', done => {
    request(app.express)
      .post('/drives')
      .send({ op: 'backup', client: { id: 123444} })
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        drive = res.body
        console.log(res.body)
        done()
      })
  })

  it('make top dir', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${drive.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'mkdir' }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        topdir = res.body[0].data
        done()
      })
  })

  it('make second layer dir', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${topdir.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'mkdir' }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('get top dir', done => {
    request(app.express)
      .get(`/drives/${drive.uuid}/dirs/${topdir.uuid}`)
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        console.log(err)
        if (err) return done(err)
        second = res.body.entries[0]
        done()
      })
  })

  it('get second dir', done => {
    request(app.express)
      .get(`/drives/${drive.uuid}/dirs/${topdir.uuid}`)
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        console.log(err)
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('should fail 400 if size not provided, cfd1934f', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .attach('l.jpg', 'testdata/l.png', JSON.stringify({ op:'newfile', size:13377, sha256: '8e0f501f838d32d93f2217dd49dcb1e88c19bcf2c5170d53f667f8bc15a062bb', bctime: 1555555, bmtime:155555 }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        pngfile1 = res.body[0].data
        done()
      })
  })

  it('upload', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .attach('l.jpg', 'testdata/l.png', JSON.stringify({ op:'newfile', size:13377, sha256: '8e0f501f838d32d93f2217dd49dcb1e88c19bcf2c5170d53f667f8bc15a062bb', bctime: 1555555, bmtime:155555 }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        pngfile2 = res.body[0].data
        done()
      })
  })

  it('upload pdf', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .attach('1.pdf', 'testdata/1.pdf', JSON.stringify({ op:'newfile', size:1452618, sha256: '1fd31e1f26f3a68a354c236b36f7799627e1b27546fe8f3b409cbcacc7c55f39', bctime: 1555555, bmtime:155555 }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        pdffile = res.body[0].data
        done()
      })
  })

  it('get second dir', done => {
    request(app.express)
      .get(`/drives/${drive.uuid}/dirs/${second.uuid}`)
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        console.log(err)
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('delete pngfile1', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'remove', uuid: pngfile1.uuid, hash: pngfile1.hash }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('get second dir', done => {
    request(app.express)
      .get(`/drives/${drive.uuid}/dirs/${second.uuid}`)
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        console.log(err)
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('delete pngfile1 return 500', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'remove', uuid: pngfile1.uuid, hash: pngfile1.hash }))
      .expect(500)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('delete pngfile2 return 200', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${second.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'remove', uuid: pngfile2.uuid, hash: pngfile2.hash }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('delete second dir', done => {
    request(app.express)
      .post(`/drives/${drive.uuid}/dirs/${topdir.uuid}/entries`)
      .set('Authorization', 'JWT ' + token)
      .field('hello', JSON.stringify({ op: 'remove' }))
      .expect(200)
      .end((err, res) => {
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

  it('get top dir', done => {
    request(app.express)
      .get(`/drives/${drive.uuid}/dirs/${topdir.uuid}`)
      .set('Authorization', 'JWT ' + token)
      .expect(200)
      .end((err, res) => {
        console.log(err)
        if (err) return done(err)
        console.log(res.body)
        done()
      })
  })

})
