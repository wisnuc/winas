const EventEmitter = require('events')
const UUID = require('uuid')
const { isUUID, isNonNullObject, isNonEmptyString } = require('../lib/assertion')
const DataStore = require('../lib/DataStore')
const { passwordEncrypt, md4Encrypt } = require('../lib/utils') // eslint-disable-line
const request = require('superagent')
const debug = require('debug')('appifi:user')
const assert = require('assert')

const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DELETED: 'DELETED'
}

const INACTIVE_REASON = {
  IMPORT: 'import',
  TIMEOUT: 'timeout',
  REJECT: 'reject'
}

class Base {
  constructor (user, ...args) {
    this.user = user
    user.state = this
    this.enter(...args)
  }

  enter () {
  }

  exit () {
  }

  setState (nextState, ...args) {
    this.exit()
    let NextState = this.user[nextState]
    new NextState(this.user, ...args)
  }

  readi () {
    this.setState('Reading')
  }

  readn (delay) {
    this.setState('Pending', delay)
  }

  readc (callback) {
    this.setState('Reading', [callback])
  }

  destroy () {
    this.exit()
  }
}

class Idle extends Base {
  enter () {
  }

  exit () {
  }
}

class Pending extends Base {
  enter (delay) {
    assert(Number.isInteger(delay) && delay > 0)
    this.readn(delay)
  }

  exit () {
    clearTimeout(this.timer)
  }

  readn (delay) {
    assert(Number.isInteger(delay) && delay > 0)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.readi(), delay)
  }
}

class Reading extends Base {
  enter (callbacks = []) {
    this.callbacks = callbacks
    this.pending = undefined
    this.readdir = null
    this.fetch()
  }

  fetch() {
    this.request = request
      .get(`${GLOBAL_CONFIG.pipe.baseURL}/s/v1/station/user`)
      .set('Authorization', this.user.cloudConf.cloudToken || '')
      .end((err, res) => {
        if (err || !res.ok) {
          err = err || new Error('cloud return error')
          err.status = 503
          this.readn(1000)
        } else {
          let data = res.body.data
          if (data) {
            this.updateUsers(data)
          }
        }

        this.callbacks.forEach(callback => callback(err, res.body.data))
        if (Array.isArray(this.pending)) { // stay in working
          this.enter(this.pending)
        } else {
          if (typeof this.pending === 'number') {
            this.setState('Pending', this.pending)
          } else {
            this.setState('Idle')
          }
        }
      })
  }

  updateUsers(data) {
    if (data.owner.length) {
      let owner = data.owner[0]
      owner.isFirstUser = true
      // check owner
      let firstUser = this.user.users.find(u => u.isFirstUser)
      if (firstUser.winasUserId !== owner.id) {
        throw new Error('device owner change!!!!')
      }
      let users = [owner, ...data.sharer]
      this.user.storeSave(lusers => {
        // update or create
        users.forEach(u => {
          let x = lusers.find(lx => lx.winasUserId === u.id)
          if (x) {
            x.avatarUrl = u.avatarUrl
            x.username = u.nickName ? u.nickName : x.username
            x.phoneNumber = u.username
            if (x.uuid !== owner.uuid) {
              x.cloud = u.cloud === 1 ? true : false
              x.publicSpace = u.publicSpace === 1 ? true : false
              // x.createTime = new Date(u.createdAt).getTime() //skip update
            }
          } else {
            let newUser = {
              uuid: UUID.v4(),
              username: u.nickName ? u.nickName : u.username,
              isFirstUser: false,
              status: USER_STATUS.ACTIVE,
              winasUserId: u.id,
              avatarUrl: u.avatarUrl,
              phoneNumber: u.username,
              winasUserId: u.id
            }
            lusers.push(newUser)
          }
        })
        // lost ??

        return [...lusers]
      }, err => err ? console.log(err) : '')
    }
    else {
      if (this.user.users.length) {
        // do what?
        throw new Error('could not found owner in cloud')
      }
      console.log('no user bound')
    }
  }

  exit () {
  }

  readi () {
    if (!Array.isArray(this.pending)) this.pending = []
  }

  readn (delay) {
    if (Array.isArray(this.pending)) {

    } else if (typeof this.pending === 'number') {
      this.pending = Math.min(this.pending, delay)
    } else {
      this.pending = delay
    }
  }

  readc (callback) {
    if (Array.isArray(this.pending)) {
      this.pending.push(callback)
    } else {
      this.pending = [callback]
    }
  }

  destroy () {
    let err = new Error('destroyed')
    err.code = 'EDESTROYED'
    this.callbacks.forEach(cb => cb(err))
    if (Array.isArray(this.pending)) this.pending.forEach(cb => cb(err))
    this.request.abort()
    super.destroy()
  }
}

/**

The corresponding test file is test/unit/fruitmix/user.js

Using composition instead of inheritance.
*/
class User extends EventEmitter {
  /**
  Create a User

  Add other properties to opts if required.

  @param {object} opts
  @param {string} opts.file - path of users.json
  @param {string} opts.tmpDir - path of tmpDir (should be suffixed by `users`)
  @param {boolean} opts.isArray - should be true since users.json is an array
  */
  constructor (opts) {
    super()
    this.conf = opts.configuration
    this.cloudConf = opts.cloudConf
    this.fruitmixDir = opts.fruitmixDir
    this.store = new DataStore({
      file: opts.file,
      tmpDir: opts.tmpDir,
      isArray: true
    })

    this.store.on('Update', (...args) => this.emit('Update', ...args))

    this.once('Update', () => new Pending(this, 200))

    Object.defineProperty(this, 'users', {
      get () {
        return this.store.data || []
      }
    })
  }

  usersUpdate() {
    this.state && this.state.readi()
  }

  getUser (userUUID) {
    return this.users.find(u => u.uuid === userUUID && u.status !== USER_STATUS.DELETED)
  }

  /**
   * data 为数组或者方法
   * 所有的存储任务提交前先检查约束条件是否都过关
   */
  storeSave (data, callback) {
    this.store.save(users => {
      let changeData = typeof data === 'function' ? data(users) : data
      // check rules
      if (changeData) {
        if (changeData.filter(u => u.status === USER_STATUS.ACTIVE).length > 10) {
          throw Object.assign(new Error('active users max 10'), { status: 400 })
        }
      }
      // clean reason
      changeData.forEach(u => {
        if (u.status !== USER_STATUS.INACTIVE && u.reason) {
          u.reason = undefined
        }
      })
      return changeData
    }, callback)
  }

  /**

  TODO lastChangeTime is required by smb
  TODO createTime is required by spec
  */
  createUser (props, callback) {
    let uuid = UUID.v4()
    this.storeSave(users => {
      let isFirstUser = users.length === 0
      let { username, phicommUserId, winasUserId, password, smbPassword, phoneNumber } = props // eslint-disable-line

      let cU = users.find(u => u.username === username)
      if (cU && cU.status !== USER_STATUS.DELETED) throw new Error('username already exist')
      let pnU = users.find(u => u.phoneNumber === phoneNumber)
      if (pnU && pnU.status !== USER_STATUS.DELETED) throw new Error('phoneNumber already exist')

      if (GLOBAL_CONFIG.type === 'phi') {
        let pU = users.find(u => u.phicommUserId === phicommUserId)
        if (pU && pU.status !== USER_STATUS.DELETED) throw new Error('phicommUserId already exist')
      }

      if (GLOBAL_CONFIG.type === 'winas') {
        let pU = users.find(u => u.winasUserId === winasUserId)
        if (pU && pU.status !== USER_STATUS.DELETED) throw new Error('winasUserId already exist')
      }

      let newUser = {
        uuid,
        username: props.username,
        isFirstUser,
        phicommUserId: props.phicommUserId, // for phi
        password: props.password, // for phi
        smbPassword: props.smbPassword,
        status: USER_STATUS.ACTIVE,
        createTime: new Date().getTime(),
        lastChangeTime: new Date().getTime(),
        phoneNumber: props.phoneNumber,
        winasUserId: props.winasUserId // for winas
      }

      if (GLOBAL_CONFIG.type === 'phi') newUser.itime = new Date().getTime() // inviteTime, serve for check invite timeout

      return [...users, newUser]
    }, (err, data) => {
      if (err) return callback(err)
      return callback(null, data.find(x => x.uuid === uuid))
    })
  }

  updateUser (userUUID, props, callback) {
    let { username, status, phoneNumber, smbPassword } = props
    this.storeSave(users => {
      let index = users.findIndex(u => u.uuid === userUUID)
      if (index === -1) throw new Error('user not found')
      let nextUser = Object.assign({}, users[index])
      if (nextUser.status === USER_STATUS.DELETED) throw new Error('deleted user can not update')
      if (username) {
        if (users.find(u => u.username === username && u.status !== USER_STATUS.DELETED)) throw new Error('username already exist')
        nextUser.username = username
      }
      if (phoneNumber) {
        if (users.find(u => u.phoneNumber === phoneNumber && u.status !== USER_STATUS.DELETED)) throw new Error('phoneNumber already exist')
        nextUser.phoneNumber = phoneNumber
      }
      if (smbPassword) {
        nextUser.smbPassword = md4Encrypt(smbPassword)
        nextUser.lastChangeTime = new Date().getTime()
      }
      if (status) nextUser.status = status
      return [...users.slice(0, index), nextUser, ...users.slice(index + 1)]
    }, (err, data) => {
      if (err) return callback(err)
      return callback(null, data.find(x => x.uuid === userUUID))
    })
  }

  updatePassword (userUUID, props, callback) {
    if (GLOBAL_CONFIG.type === 'winas '){
      return callback(Object.assign(new Error('not found'), { status: 404 }))
    }
  }

  bindFirstUser (boundUser) {
    // if (GLOBAL_CONFIG.type !== 'phi') return console.log('bindFirstUser only use for phi')
    this.storeSave(users => {
      let index = users.findIndex(u => u.isFirstUser)
      if (index === -1) {
        return [{
          uuid: UUID.v4(),
          username: boundUser.name || boundUser.username || 'admin',
          isFirstUser: true,
          phicommUserId: boundUser.phicommUserId,
          password: boundUser.password,
          smbPassword: '',
          status: USER_STATUS.ACTIVE,
          winasUserId: boundUser.id
        }]
      } else {
        let firstUser = Object.assign({}, users[index])
        if (GLOBAL_CONFIG.type === 'winas') {
          if (firstUser.winasUserId !== boundUser.id) {
            console.log('===================')
            console.log('This is not an error, but fruitmix received a bound user')
            console.log('different than the previous one, exit')
            console.log('===================')
            process.exit(67)
          }
          //TODO: refresh what?
        } else {
          if (firstUser.phicommUserId !== boundUser.phicommUserId) {
            console.log('===================')
            console.log('This is not an error, but fruitmix received a bound user')
            console.log('different than the previous one, exit')
            console.log('===================')
            process.exit(67)
          }
          // maybe undefined
          firstUser.password = boundUser.password
          if (isNonEmptyString(boundUser.phoneNumber) && firstUser.phoneNumber !== boundUser.phoneNumber) {
            if (users.find(u => u.phoneNumber === boundUser.phoneNumber && u.status !== USER_STATUS.DELETED)) {
              console.log('==============')
              console.log('update bound user phoneNumber already exist')
              console.log('update failed')
              console.log('==============')
            } else {
              console.log('==============')
              console.log('update bound user phoneNumber')
              console.log('==============')
              firstUser.phoneNumber = boundUser.phoneNumber
            }
          }
        }
        return [
          ...users.slice(0, index),
          firstUser,
          ...users.slice(index + 1)
        ]
      }
    },
    err => err
      ? console.log(`user module failed to bind first user to ${boundUser.winasUserId}`, err)
      : console.log(`user module bound first user to ${boundUser.winasUserId} successfully`))
  }

  destroy (callback) {
    this.store.destroy(callback)
    this.state && this.state.destroy()
  }

  basicInfo (user) {
    return {
      uuid: user.uuid,
      username: user.username,
      isFirstUser: user.isFirstUser,
      phicommUserId: user.phicommUserId,
      phoneNumber: user.phoneNumber,
      winasUserId: user.winasUserId,
      avatarUrl: user.avatarUrl
    }
  }

  fullInfo (user) {
    return {
      uuid: user.uuid,
      username: user.username,
      isFirstUser: user.isFirstUser,
      phicommUserId: user.phicommUserId, // for phi
      password: !!user.password,
      smbPassword: !!user.smbPassword,
      createTime: user.createTime,
      status: user.status,
      phoneNumber: user.phoneNumber,
      reason: user.reason, // for phi
      winasUserId: user.winasUserId,
      avatarUrl: user.avatarUrl
    }
  }

  /**
  Implement LIST method
  */
  LIST (user, props, callback) {
    if (!user) {
      // basic info of all users
      return process.nextTick(() => callback(null, this.users.filter(u => u.status === USER_STATUS.ACTIVE).map(u => this.fullInfo(u))))
    } else if (user.isFirstUser) {
      // full info of all users
      return process.nextTick(() => callback(null, this.users.filter(u => u.status !== USER_STATUS.DELETED).map(u => this.fullInfo(u))))
    } else {
      // full info of the user
      return process.nextTick(() => {
        let u = this.users.find(u => u.uuid === user.uuid)
        if (!u) {
          let err = new Error('authenticated user not found in user resource')
          err.status = 500
          callback(err)
        } else {
          callback(null, [this.fullInfo(u)])
        }
      })
    }
  }

  /**
  Implement POST method

  wisnuc: the first user can be created by anonymous user
  phicomm: the first user cannot be created by api. It must be injected.
  */
  POST (user, props, callback) {
    if (!isNonNullObject(props)) return callback(Object.assign(new Error('props must be non-null object'), { status: 400 }))
    let recognized
    if (GLOBAL_CONFIG.type === 'phi') {
      recognized = ['username', 'phicommUserId', 'phoneNumber']
    } else {
      recognized = ['username', 'password', 'phoneNumber', 'winasUserId']
      return callback(Object.assign(new Error('not found'), { status: 404 }))
    }
    Object.getOwnPropertyNames(props).forEach(key => {
      if (!recognized.includes(key)) throw Object.assign(new Error(`unrecognized prop name ${key}`), { status: 400 })
    })
    if (!isNonEmptyString(props.username)) return callback(Object.assign(new Error('username must be non-empty string'), { status: 400 }))
    if (props.phicommUserId && !isNonEmptyString(props.phicommUserId)) return callback(Object.assign(new Error('phicommUserId must be non-empty string'), { status: 400 }))
    if (!isNonEmptyString(props.phoneNumber)) return callback(Object.assign(new Error('phoneNumber must be non-empty string'), { status: 400 }))
    if (props.password && !isNonEmptyString(props.password)) return callback(Object.assign(new Error('password must be non-empty string'), { status: 400 }))
    if (this.users.length && (!user || !user.isFirstUser)) return process.nextTick(() => callback(Object.assign(new Error('Permission Denied'), { status: 403 })))
    if (props.password) {
      props.password = passwordEncrypt(props.password, 10)
    }
    this.createUser(props, (err, user) => err ? callback(err) : callback(null, this.fullInfo(user)))
  }

  /**
  Implement GET method
  */
  GET (user, props, callback) {
    let userUUID = props.userUUID
    let u = isUUID(userUUID) ? this.getUser(props.userUUID) : this.users.find(u => u.phicommUserId && u.phicommUserId === props.userUUID && u.status !== USER_STATUS.DELETED)
    if (!u) return process.nextTick(() => callback(Object.assign(new Error('user not found'), { status: 404 })))
    if (user.isFirstUser || user.uuid === u.uuid) return process.nextTick(() => callback(null, this.fullInfo(u)))
    return process.nextTick(Object.assign(new Error('Permission Denied'), { status: 403 }))
  }

  /**
  Implement PATCH
  */
  PATCH (user, props, callback) {
    if (GLOBAL_CONFIG.type === 'winas'){
      return callback(Object.assign(new Error('not found'), { status: 404 }))
    }

    let userUUID
    let devU = isUUID(props.userUUID) ? this.users.find(u => u.uuid === props.userUUID && u.status !== USER_STATUS.DELETED)
      : this.users.find(u => u.phicommUserId === props.userUUID && u.status !== USER_STATUS.DELETED)
    if (!devU) return callback(Object.assign(new Error('user not found'), { status: 404 }))
    userUUID = devU.uuid

    if (props.password) {
      let recognized = ['password', 'userUUID', 'encrypted']
      if (!Object.getOwnPropertyNames(props).every(k => recognized.includes(k))) {
        return process.nextTick(() => callback(Object.assign(new Error('too much props in body'), { status: 400 })))
      }
      if (user.uuid !== userUUID) return process.nextTick(() => callback(Object.assign(new Error('Permission Denied'), { status: 403 })))
      this.updatePassword(userUUID, props, (err, user) => err ? callback(err) : callback(null, this.fullInfo(user)))
    } else {
      let recognized = ['username', 'status', 'userUUID', 'phoneNumber', 'smbPassword']
      if (!Object.getOwnPropertyNames(props).every(k => recognized.includes(k))) {
        return process.nextTick(() => callback(Object.assign(new Error('too much props in body'), { status: 400 })))
      }

      if (props.username && !isNonEmptyString(props.username)) return callback(Object.assign(new Error('username must be non-empty string'), { status: 400 }))

      let u = this.users.find(u => u.username === props.username)
      if (u && u.status !== USER_STATUS.DELETED) return callback(Object.assign(new Error('username exist'), { status: 400 }))
      let recognizedStatus = [USER_STATUS.ACTIVE, USER_STATUS.INACTIVE, USER_STATUS.DELETED]

      if (props.status && !user.isFirstUser) return callback(Object.assign(new Error('Permission Denied'), { status: 403 }))
      if (props.status && user.uuid === userUUID) return callback(Object.assign(new Error('can not change admin status'), { status: 400 }))
      if (props.status && !recognizedStatus.includes(props.status)) return callback(Object.assign(new Error('unknown status'), { status: 400 }))

      if (!user.isFirstUser && user.uuid !== userUUID) return process.nextTick(() => callback(Object.assign(new Error('Permission Denied'), { status: 403 })))
      this.updateUser(userUUID, props, (err, data) => err ? callback(err) : callback(null, this.fullInfo(data)))
    }
  }

  DELETE (user, props, callback) {
    if (GLOBAL_CONFIG.type === 'winas '){
      return callback(Object.assign(new Error('not found'), { status: 404 }))
    }
    let userUUID
    let devU = isUUID(props.userUUID) ? this.users.find(u => u.uuid === props.userUUID && u.status !== USER_STATUS.DELETED)
      : this.users.find(u => u.phicommUserId && u.phicommUserId === props.userUUID && u.status !== USER_STATUS.DELETED)
    if (!devU) return callback(Object.assign(new Error('user not found'), { status: 404 }))
    userUUID = devU.uuid

    if (!user.isFirstUser) return callback(Object.assign(new Error('Permission Denied'), { status: 403 }))
    this.updateUser(userUUID, { status: USER_STATUS.DELETED }, callback)
  }
}

User.prototype.USER_STATUS = USER_STATUS
User.prototype.Idle= Idle
User.prototype.Pending = Pending
User.prototype.Reading = Reading

module.exports = User
