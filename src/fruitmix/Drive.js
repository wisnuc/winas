const EventEmitter = require('events')

const UUID = require('uuid')
const { isUUID, isNonEmptyString } = require('../lib/assertion')

const DataStore = require('../lib/DataStore')

class Drive extends EventEmitter {
  /**
  Create a Drive

  @param {object} opts
  @param {string} opts.file - path of drives.json
  @param {string} opts.tmpDir - path of tmpDir (should be suffixed by 'drives')
  */
  constructor (opts, user) {
    super()
    this.conf = opts.configuration // is this required ??? TODO:

    // fruitmixDir is not used ??? TODO
    // this.fruitmixDir = opts.fruitmixDir

    this.user = user

    this.user.on('Update', this.handleUserUpdate.bind(this))

    this.store = new DataStore({
      file: opts.file,
      tmpDir: opts.tmpDir,
      isArray: true
    })

    this.store.on('Update', (...args) => this.emit('Update', ...args))

    Object.defineProperty(this, 'users', {
      get () {
        return this.user.users || []
      }
    })

    // effective drive?
    Object.defineProperty(this, 'drives', {
      get () {
        return this.store.data
      }
    })
  }

  handleUserUpdate (users) {
    let deletedUsers = users.filter(u => u.status === this.user.USER_STATUS.DELETED).map(u => u.uuid)
    if (!deletedUsers.length) return
    this.store.save(drives => {
      let tmpDrives = JSON.parse(JSON.stringify(drives))
      tmpDrives.forEach(tD => {
        if ((tD.privacy === true || tD.type === 'backup') && deletedUsers.includes(tD.owner)) {
          tD.isDeleted = true
        }
        else if (tD.privacy === false　&& tD.tag !== 'built-in') {
          deletedUsers.forEach(dU => {
            if (Array.isArray(tD.writelist)) {
              let wl = new Set(tD.writelist)
              wl.delete(dU)
              tD.writelist = Array.from(wl).sort()
            }
            if (Array.isArray(tD.readlist)) {
              let rl = new Set(tD.readlist)
              rl.delete(dU)
              tD.readlist = Array.from(rl).sort()
            }
          })
        }
      })
      return tmpDrives
    }, () => {})
  }

  // check save rules here
  storeSave(data, callback) {
    this.store.save(drives => {
      let changeData = typeof data === 'function' ? data(drives) : data
      // check rules
      if (changeData) {
        let pubDrives = changeData.filter(d => d.privacy === false && d.writelist !== '*' && !d.isDeleted)
        let firstUser = this.user.users.find(u => u.isFirstUser).uuid
        pubDrives.forEach(d => {
          if (!d.writelist.includes(firstUser)) {
            d.writelist.push(firstUser)
            d.writelist = Array.from(new Set(d.writelist)).sort()
          }
        })
      }
      return changeData
    }, callback)
  }

  /**
  This
  */
  retrieveDrives (userUUID, callback) {
    this.storeSave(drives => {
      let priv = drives.find(drv => drv.privacy === true && drv.owner === userUUID)
      let builtIn = drives.find(drv => drv.privacy === false && drv.tag === 'built-in')

      if (priv && builtIn) {
        return drives
      } else {
        let newDrives = [...drives]
        if (!priv) {
          newDrives.push({
            uuid: UUID.v4(),
            type: 'classic',
            privacy: true,
            owner: userUUID,
            tag: 'home',
            label: '',
            isDeleted: false,
            smb: true,
            ctime: new Date().getTime(),
            mtime: new Date().getTime()
          })
        }

        if (!builtIn) {
          newDrives.push({
            uuid: UUID.v4(),
            type: 'classic',
            privacy: false,
            writelist: '*',
            readlist: '*',
            label: '',
            tag: 'built-in',
            isDeleted: false,
            smb: true,
            ctime: new Date().getTime(),
            mtime: new Date().getTime()
          })
        }
        return newDrives
      }
    }, (err, drives) => {
      err ? callback(err)
        : callback(null, [
          ...drives.filter(drv => (drv.privacy === true || drv.type === 'backup') && drv.owner === userUUID),
          ...drives.filter(drv => drv.privacy === false && (drv.writelist === '*' || drv.writelist.includes(userUUID)))
        ])
    })
  }

  createPublicDrive (props, callback) {

    if (GLOBAL_CONFIG.type === 'winas') {
      return callback(Object.assign(new Error('There can be only three public drives'), { status: 400 }))
    }

    let drive = {
      uuid: UUID.v4(),
      type: 'classic',
      privacy: false,
      writelist: props.writelist || [],
      readlist: props.readlist || [],
      label: props.label || '',
      smb: true,
      ctime: new Date().getTime(),
      mtime: new Date().getTime(),
      isDeleted: false
    }

    // TODO create directory

    this.storeSave(drives => {
      if (drives.filter(d => d.privacy === false && !d.isDeleted).length >= 3) throw Object.assign(new Error('There can be only three public drives'), { status: 400 })
      if (props.label && !drives.filter(d => !d.isDeleted).every(d => d.label !== props.label)) {
        throw Object.assign(new Error('label has already been used'), { status: 400 })
      }
      return [...drives, drive]
    }, (err, drives) => err ? callback(err) : callback(null, drive))
  }

  /**
   * 
   * @param {*} user 
   * @param {*} props 
   * props.client
   *  client.id
   *  client.type
   *  client.bptime
   *  client.isFinished
   * @param {*} callback 
   */
  createBackupDrive (user, props, callback) {
    let client = typeof props.client === 'object' ? props.client : {}
    let drive = {
      uuid: UUID.v4(),
      type: 'backup',
      owner: user.uuid,
      label: props.label || '',
      smb: false,
      client,
      ctime: new Date().getTime(),
      mtime: new Date().getTime(),
      isDeleted: false
    }

    this.storeSave(drives => [...drives, drive]
    , (err, drives) => err ? callback(err) : callback(null, drive))
  }

  updateBackupDrive (user, props, callback) {
    this.storeSave(drives => {
      let index = drives.findIndex(drv => drv.uuid === props.driveUUID)
      if (index === -1) throw new Error('backup drive not found')
      let priv = Object.assign({}, drives[index])
      if (user.uuid !== priv.owner) throw new Error('Permission Denied')
      if (typeof props.smb === 'boolean') {
        priv.smb = props.smb
      }
      if (props.label) priv.label = props.label
      if (props.client && typeof props.client === 'object') priv.client = props.client
      priv.mtime = new Date().getTime()
      return [...drives.slice(0, index), priv, ...drives.slice(index + 1)]
    }, (err, data) => err ? callback(err) : callback(null, data.find(d => d.uuid === props.driveUUID)))
  }

  deleteBackupDrive (user, props, callback) {
    this.storeSave(drives => {
      let index = drives.findIndex(drv => drv.uuid === props.driveUUID)
      if (index === -1) throw Object.assign(new Error('backup drive not found'), { status: 404 })
      let drv = Object.assign({}, drives[index])
      if (user.uuid !== drv.owner) throw new Error('Permission Denied')
      if (drv.isDeleted || drv.type !== 'backup') throw Object.assign(new Error('backup drive not found'), { status: 404 }) 
      drv.isDeleted = true
      drv.mtime = new Date().getTime()
      return [...drives.slice(0, index), drv, ...drives.slice(index + 1)]
    }, (err, data) => err ? callback(err) : callback(null, null))
  }

  getDrive (driveUUID) {
    return this.drives.find(d => d.uuid === driveUUID)
  }

  updateDrive (driveUUID, props, callback) {
    this.storeSave(drives => {
      let index = drives.findIndex(drv => drv.uuid === driveUUID)
      if (index === -1) throw new Error('drive not found')
      let priv = Object.assign({}, drives[index])
      if (priv.privacy === false) {
        if (props.writelist) {                
          if (props.writelist === '*' || props.writelist.every(uuid => !!this.users.find(u => u.uuid === uuid))) priv.writelist = props.writelist
          else throw new Error('writelist not all user uuid found')
        }
      }
      if (typeof props.smb === 'boolean') {
        priv.smb = props.smb
      }
      if (props.label) {
        if (drives.filter(d => !d.isDeleted).every(d => d.label !== props.label)) priv.label = props.label
        else throw new Error('label has already been used')
      }
      priv.mtime = new Date().getTime()
      return [...drives.slice(0, index), priv, ...drives.slice(index + 1)]
    }, (err, data) => err ? callback(err) : callback(null, data.find(d => d.uuid === driveUUID)))
  }

  deleteDrive (driveUUID, props, callback) {
    this.storeSave(drives => {
      let index = drives.findIndex(drv => drv.uuid === driveUUID)
      if (index === -1) throw Object.assign(new Error('drive not found'), { status: 404 })
      let drv = Object.assign({}, drives[index])
      if (drv.isDeleted) throw Object.assign(new Error('drive not found'), { status: 404 }) 
      drv.isDeleted = true
      drv.mtime = new Date().getTime()
      return [...drives.slice(0, index), drv, ...drives.slice(index + 1)]
    }, (err, data) => err ? callback(err) : callback(null, null))
  }

  /**
   * @argument userUUID - user uuid
   * @argument driveUUID - drive uuid
   */
  userCanReadDrive (userUUID, driveUUID) {
    let drv = this.getDrive(driveUUID)
    if (!drv) return false
    if (drv.isDeleted) return false
    if ((drv.privacy === true || drv.type === 'backup') && drv.owner === userUUID) return true
    if (drv.privacy === false && (drv.writelist === '*' || drv.writelist.includes(userUUID))) return true
    return false
  }
 
  LIST (user, props, callback) {
    this.retrieveDrives(user.uuid, (err, drives) => {
      if (err) return callback(err)
      callback(null, drives.filter(d => !d.isDeleted))
    })
  }

  /**
   *
   * @param {object} user
   * @param {object} props
   * @param {string} props.driveUUID
   * @param {function} callback
   */
  GET (user, props, callback) {
    if (!this.userCanReadDrive(user.uuid, props.driveUUID)) return process.nextTick(() => callback(Object.assign(new Error('Permission Denied'), { status: 403 })))
    let drv = this.getDrive(props.driveUUID)
    if (!drv || drv.isDeleted) return process.nextTick(() => callback(Object.assign(new Error('drive not found'), { status: 403 })))
    process.nextTick(() => callback(null, drv))
  }

  /**
   * @param {object} user
   * @param {object} props
   * @param {array} props.writelist
   * @param {array} props.readlist
   * @param {string} props.label
   * @param {Function} callback
   */
  POST (user, props, callback) {
    if (props.op && props.op === 'backup') {
      return this.createBackupDrive(user, props, callback)
    }
    let recognized = ['writelist', 'label'] // 'readlist',
    try {
      Object.getOwnPropertyNames(props).forEach(name => {
        if (!recognized.includes(name)) {
          throw Object.assign(new Error(`unrecognized prop name ${name}`), { status: 400 })
        }
        if (name === 'writelist' || name === 'readlist') {  
          if (props[name] !== '*' && !Array.isArray(props[name])) {
            throw Object.assign(new Error(`${name} must be either wildcard or an uuid array`), { status: 400 })
          } else if (Array.isArray(props[name])){
            if (!props[name].every(uuid => !!this.users.find(u => u.uuid === uuid))) {
              let err = new Error(`${name} not all user uuid found`) // TODO
              err.code = 'EBADREQUEST'
              err.status = 400
              throw err
            }
            props[name] = Array.from(new Set(props[name])).sort()
          }else
            props[name] = '*'
        }
        if (name === 'label' && typeof props[name] !== 'string') throw Object.assign(new Error(`label must be string`), { status: 400 })
      })
    } catch (e) {
      return callback(e)
    }
    if (!user.isFirstUser) return callback(Object.assign(new Error(`requires admin priviledge`), { status: 403 }))
    this.createPublicDrive(props, callback)
  }

  PATCH (user, props, callback) {
    let driveUUID = props.driveUUID
    try {
      let drive = this.drives.find(drv => drv.uuid === driveUUID)
      if (!drive || drive.isDeleted) {
        throw Object.assign(new Error(`drive ${driveUUID} not found`), { status: 404 })
      }
      if (drives.type === 'backup') {
        return this.updateBackupDrive(user, props, callback)
      }
      delete props.driveUUID
      let recognized
      if (drive.privacy === true || (drive.privacy === false && drive.tag === 'built-in')) recognized = ['label', 'smb']
      else recognized = ['writelist', 'label', 'smb'] // 'readlist',

      Object.getOwnPropertyNames(props).forEach(key => {
        if (!recognized.includes(key)) {
          throw Object.assign(new Error(`unrecognized prop name ${key}`), { status: 400 })
        }

        if (key === 'label' && !isNonEmptyString(props[key])) throw Object.assign(new Error(`label must be non empty string`), { status: 400 })
        if (key === 'smb' && typeof props[key] !== 'boolean') throw Object.assign(new Error(`smb must be boolean`), { status: 400 })

        // validate writelist, readlist
        if (key === 'writelist' || key === 'readlist') {
          let list = props[key]
          if (list === '*') return
          if (!Array.isArray(list) || !list.every(x => isUUID(x))) {
            let err = new Error(`${key} must be either wildcard or an uuid array`)
            err.code = 'EBADREQUEST'
            err.status = 400
            throw err
          }
          if (!list.every(uuid => !!this.users.find(u => u.uuid === uuid))) {
            let err = new Error(`${key} not all user uuid found`) // TODO
            err.code = 'EBADREQUEST'
            err.status = 400
            throw err
          }
          props[key] = Array.from(new Set(list)).sort()
        }
      })

      if (drive.privacy === false && !user.isFirstUser) {
        throw Object.assign(new Error(`requires admin priviledge`), { status: 403 })
      }

      if (drive.privacy === true && user.uuid !== drive.owner) {
        throw Object.assign(new Error(`only owner can update`), { status: 403 })
      }
    } catch (e) {
      return process.nextTick(() => callback(e))
    }

    this.updateDrive(driveUUID, props, callback)
  }

  DELETE (user, props, callback) {
    let driveUUID = props.driveUUID
    let drive = this.drives.find(drv => drv.uuid === driveUUID)
    if (drive && drive.type === 'backup') return this.deleteBackupDrive(user, props, callback)
    if (!user || !user.isFirstUser) return callback(Object.assign(new Error('Permission Denied'), { status: 403 }))
    if (Object.getOwnPropertyNames(props).length !== 1) return callback(Object.assign(new Error('invalid parameters'), { status: 400 }))
    if (!drive || drive.privacy !== false || drive.isDeleted) return callback(Object.assign(new Error('invalid driveUUID'), { status: 400 }))
    if (drive.tag === 'built-in') return callback(Object.assign(new Error('built-in drive can not be deleted'), { status: 400 }))
    this.deleteDrive(driveUUID, props, callback)
  }
}

module.exports = Drive
