const path = require('path')
const fs = require('fs')
const child = require('child_process')
const os = require('os')
const UUID = require('uuid')

const mkdirp = require('mkdirp')
const getArgs = require('get-args')
const config = require('config')

const { passwordEncrypt } = require('./lib/utils')
const configurations = require('./configurations')
const Fruitmix = require('./fruitmix/Fruitmix')
const App = require('./app/App')

global.GLOBAL_CONFIG = config

/**
This is the entry point of the program.

CreateApp parses args and create the App accordingly.

--standalone                  start appifi without bootstrap
  --mdns                      fake mdns broadcasting
  --fruitmix-only             start fruitmix without boot
  --fruitmix-dir path/to/dir  use the given path as fruitmix root directory.
  --alice                     use alice as bound user
--smb                         use smb
--dlna                        use dlna
--transmission                use transmission
--webtorrent                  use webtorrent

@module createApp
*/

let isRoot = process.getuid && process.getuid() === 0
let args = (getArgs(process.argv)).options

// console.log(args)

// only standalone && fruitmix-only mode allows non-priviledged user
if (!(args.standalone && args['fruitmix-only']) && !isRoot)
  throw new Error('boot module requires root priviledge')

if (args.smb && !isRoot) throw new Error('smb feature requires root priviledge')
if (args.dlna && !isRoot) throw new Error('dlna feature requires root priviledge')
if (args.transmission && !isRoot) throw new Error('transmission feature requires root priviledge')

if (args.mdns && !isRoot) throw new Error('mdns requires root priviledge')

let fruitmixOpts = {
  useSmb: !!args.smb,
  useDlna: !!args.dlna,
  useTransmission: !!args.transmission,
}

// in standalone mode
if (args.standalone) {
  if (args['fruitmix-only']) {
    if (args['fruitmix-dir']) {
      fruitmixOpts.fruitmixDir = args['fruitmix-dir']

    } else {
      let cwd = process.cwd()
      let tmptest = path.join(cwd, 'tmptest')
      mkdirp.sync(tmptest)
      fruitmixOpts.fruitmixDir = tmptest
    }

    if (!!args['alice']) {
      fruitmixOpts.boundUser = {
        phicommUserId: 'alice',
        password: passwordEncrypt('alice', 10)
      }
    }

    let fruitmix = new Fruitmix(fruitmixOpts)
    let app = new App({
      fruitmix,
      useServer: true,
    })
  } else {
    let configuration = configurations.wisnuc.winas
    // console.log('configuration', configuration)
    fruitmixOpts.useSmb = !!args.smb || configuration.smbAutoStart
    fruitmixOpts.useDlna = !!args.dlna || configuration.dlnaAutoStart
    let app = new App({
      fruitmixOpts,
      configuration,
      useAlice: !!args['alice'],
      useServer: true,
      listenProcess: true
    })
  }
}

// print freemem per 60s
// setInterval(() => console.log('process info:', Object.assign({
//   uptime: process.uptime(),
//   freemem: os.freemem()
// }, process.memoryUsage())), 60 * 1000)
