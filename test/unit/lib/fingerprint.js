const Promise = require('bluebird')
const path = require('path')
const fs = require('fs')
const EventEmitter = require('events')

const rimrafAsync = Promise.promisify(require('rimraf'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const UUID = require('uuid')

const chai = require('chai').use(require('chai-as-promised'))
const expect = chai.expect
const should = chai.should()

const Fingerprint = require('src/lib/fingerprint2')

const { FILES } = require('test/agent/lib')

const cwd = process.cwd()
const tmptest = path.join(cwd, 'tmptest')

describe(path.basename(__filename), () => {

  beforeEach(async () => {
    await rimrafAsync(tmptest)
    await mkdirpAsync(tmptest)
  })

  Object.keys(FILES).forEach(name => it(`calc fingerprint of ${name}`, function (done) {
    this.timeout(0)

    let fp = new Fingerprint(FILES[name].path)
    fp.on('data', fingerprint => {
      expect(fingerprint).to.equal(FILES[name].hash)
      done()
    })

  }))

})
