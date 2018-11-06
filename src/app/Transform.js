const EventEmitter = require('events')
const pathToRegexp = require('path-to-regexp')
const _ = require('lodash')
const request = require('request')
const path = require('path')
const fs = require('fs')
const debug = require('debug')('ws:transform')

const routing = require('./routing')

const getURL = (stationId, jobId) => `https://abel.nodetribe.com/s/v1/station/${stationId}/response/${jobId}`

const RE_BOUNDARY = /^multipart\/.+?(?:; boundary=(?:(?:"(.+)")|(?:([^\s]+))))$/i
const routes = []
// routing map
// [{
//   path: '/drives/:driveUUID/dirs/:dirUUID',
//   keys: [],
//   verb: 'GET',
//   api: 'drives',
//   pathToRegexp: '////',
//   pathParttens： [ driveUUID, dirUUID ]
// }]
for (const k in routing) {
  for (const r of routing[k].routes) {
    const path = r[0] === '/' ? routing[k].prefix : routing[k].prefix + r[0]
    let keys = []
    const re = pathToRegexp(path, keys)
    routes.push({
      path: path,
      verb: r[1],
      api: r[2],
      pathToRegexp: re,
      pathParttens: _.map(keys, 'name')
    })
  }
}

const WHITE_LIST = {
  token: 'token',
  boot: 'boot',
  users: 'user',
  drives: 'drives',
  tags: 'tag',
  files: 'file',
  media: 'media',
  tasks: 'task',
  'phy-drives': 'nfs',
  device: 'device',
  fruitmix: 'fruitmix',
  samba: 'samba',
  dlna: 'dlna'
}

/**
 * format error
 * @param {object} error
 * @param {number} status - http code
 * @return {object} formatError
 */
const formatError = (error, status) => {
  status = status || 403
  let formatError
  if (error instanceof Error) {
    formatError = error
    formatError.status = error.status ? error.status : status
  } else if (typeof err === 'string') {
    formatError = new Error(error)
    formatError.status = status
  }
  return formatError
}

class Pipe extends EventEmitter {
  /**
   * Create a Pipe
   * @param {object} ctx
   * @param {object} ctx.fruitmix()
   * @param {object} ctx.config
   */
  constructor (ctx) {
    super()
    this.ctx = ctx
  }
  /**
   * check authorization
   * @param {string} phicommUserId
   * @return {object} user
   */
  checkUser (winasUserId) {
    let user
    if (!this.ctx.fruitmix()) {
      user = null
    } else {
      user = this.ctx.fruitmix().getUserByWinasUserId(winasUserId)
    }
    if (!user) throw formatError(new Error(`uid: ${winasUserId}, check user failed`), 401)
    // throw 503 unavailable if fruitmix === null
    return Object.assign({}, user, { remote: true })
  }
  /**
   * get token for cloud
   * @param {object} user
   * @return {object} token
   */
  getToken (user) {
    return this.ctx.config.auth().tokenForRemote(user)
  }
  /**
   * get boot info
   * @param {object} user
   * @return {object} bootInfo
   */
  getBootInfo (user) {
    return this.ctx.boot.view()
  }
  /**
   * check message properties
   * @param {object} message
   */
  checkMessage (message) {
    if (!message) throw formatError(new Error('pipe have no message'), 400)

    if (!message.sessionId) {
      throw formatError(new Error(`message have no msgId`), 400)
    }
    if (!message.user || !message.user.id) {
      throw formatError(new Error(`this msgId: message have no user`), 400)
    }
    if (!message.verb) {
      throw formatError(new Error(`this msgId: data have no verb`), 400)
    }
    if (!message.urlPath) {
      throw formatError(new Error(`this msgId: data have no urlPath`), 400)
    }
  }
  /**
   * handle message from pipe
   * @param {object} message
   */
  handleMessage (message) {
    try {
      this.checkMessage(message)
      const user = this.checkUser(message.user.id)
      // reponse to cloud
      const { urlPath, verb, body, params } = message
      const paths = urlPath.split('/') // ['', 'drives', '123', 'dirs', '456']
      const resource = WHITE_LIST[paths[1]]
      if (!resource) {
        throw formatError(new Error(`this resource: ${resource}, not support`), 400)
      }
      // 由于 token 没有 route， 单独处理 token
      if (resource === 'token') {
        return this.reqCommand(message, null, this.getToken(user))
      }
      // 单独处理 boot
      if (resource === 'boot' && paths.length === 2) {
        if (verb.toUpperCase() === 'GET') return this.reqCommand(message, null, this.getBootInfo())
        else if (verb.toUpperCase() === 'PATCH') {
          return this.ctx.boot.PATCH_BOOT(user, body, err => this.reqCommand(message, err, {}))
        }
        throw formatError(new Error('not found'), 404)
      }

      if (resource === 'device') {
        switch (paths.length) {
          case 2:
            if (verb.toUpperCase() === 'GET') return this.reqCommand(message, null, this.ctx.device.view())
            break
          case 3:
            if (paths[2] === 'cpuInfo' && verb.toUpperCase() === 'GET') {
              return this.ctx.device.cpuInfo((err, data) => this.reqCommand(message, err, data))
            } else if (paths[2] === 'memInfo' && verb.toUpperCase() === 'GET') {
              return this.ctx.device.memInfo((err, data) => this.reqCommand(message, err, data))
            } else if (paths[2] === 'net') {
              if (verb.toUpperCase() === 'GET') return this.ctx.device.interfaces((err, its) => this.reqCommand(message, err, its))
            } else if (paths[2] === 'speed' && verb.toUpperCase() === 'GET') {
              return this.reqCommand(message, null, this.ctx.device.netDev())
            } else if (paths[2] === 'timedate' && verb.toUpperCase() === 'GET') {
              return this.ctx.device.timedate((err, data) => this.reqCommand(message, err, data))
            } else if (paths[2] === 'sleep') {
              if (verb.toUpperCase() === 'GET') {
                return this.reqCommand(message, null, this.ctx.device.sleepConf)
              } else if (verb.toUpperCase() === 'PATCH') {
                return this.ctx.device.updateSleepMode(user, body, (err, data) => this.reqCommand(message, err, data))
              }
            }
            throw formatError(new Error('not found'), 404)
          default:
            throw formatError(new Error('not found'), 404)
        }
      }

      // match route path
      const matchRoutes = []
      for (const route of routes) {
        // match route
        if (route.pathToRegexp.test(urlPath)) matchRoutes.push(route)
      }
      // match route api
      let method = verb.toUpperCase()
      const methods = _.map(matchRoutes, 'verb')
      if (method === 'GET') {
        method = methods.includes(method) ? method : 'LIST'
      } else if (method === 'POST') {
        method = methods.includes(method) ? method : 'POSTFORM'
      }
      // generate query
      const query = {}
      let matchRoute
      for (const ms of matchRoutes) {
        if (ms.verb === method) {
          matchRoute = ms
          const { pathToRegexp, pathParttens } = ms
          const unnamedParamters = pathToRegexp.exec(urlPath)
          // generate query
          pathParttens.map((v, index) => {
            query[v] = unnamedParamters[index + 1]
          })
        }
      }
      const opts = { user, matchRoute, method, query, body, params }
      this.apis(message, opts)
    } catch (err) {
      debug('Transform Error: ', err)
      this.reqCommand(message, err)
    }
  }
  /**
   * local apis
   * @param {object} opts
   * @param {function} callback
   * @memberof Pipe
   */
  apis (message, opts) {
    const { user, matchRoute, method, query, body, params } = opts
    const props = Object.assign({}, query, body, params)
    // postform
    if (matchRoute.verb === 'POSTFORM') {
      // Fetch
      this.getResource(message).on('response', response => {
        try {
          props.length = response.headers['content-length']
          const m = RE_BOUNDARY.exec(response.headers['content-type'])
          props.boundary = m[1] || m[2]
          props.formdata = response
        } catch (err) {
          return this.reqCommand(message, err, undefined, false, true)
        }
        // { driveUUID, dirUUID, boundary, length, formdata }
        this.ctx.fruitmix().apis[matchRoute.api][method](user, props, (err, data) => {
          this.reqCommand(message, err, data, false, true)
        })
      })
    } else {
      return this.ctx.fruitmix().apis[matchRoute.api][method](user, props, (err, data) => {
        if (err) return this.reqCommand(message, err)
        // Store
        if (typeof data === 'string' && path.isAbsolute(data)) {
          this.postResource(message, data)
        } else {
          // json
          this.reqCommand(message, null, data)
        }
      })
    }
  }
  /**
   * response command
   * @param {object} error
   * @param {object} res
   * @memberof Pipe
   */
  reqCommand (message, error, res, isFetch, isStore) {
    let resErr
    if (error) {
      error = formatError(error)
      resErr = {
        msg: error.message,
        status: error.status
      }
    }

    let uri = getURL(this.ctx.deviceSN, message.sessionId, false)
    if (isFetch) uri += '/pipe/fetch'
    else if (isStore) uri += '/pipe/store'
    else uri += '/json'
    debug(uri)
    return request({
      uri: uri,
      method: 'POST',
      headers: { Authorization: this.ctx.config.cloudToken },
      body: true,
      json: {
        error : resErr,
        data: res
      }
    }, (error, response, body) => {
      if (error) return debug('reqCommand error: ', error)
      debug('reqCommand success:', body.status)
    })
  }
  /**
   * post resource (fetch)
   * @param {string} absolutePath
   * @memberof Pipe
   */
  postResource (message, absolutePath) {

    let headers = message.headers
    let start, end
    if (headers && headers['Range']) {
      const rangeArr = headers['Range'].slice(5).split('-').filter(x => !!x)
      if (rangeArr.length === 1) {
        start = parseInt(rangeArr[0])
      }
      if (rangeArr.length === 2) {
        start = parseInt(rangeArr[0])
        end = parseInt(rangeArr[1]) - 1
      }
      console.log('required range stream: ', start, '  ', end)
    }
    request.post({
      url: getURL(this.ctx.deviceSN, message.sessionId, false),
      headers: {
        Authorization: this.ctx.config.cloudToken,
        'content-type': 'application/octet-stream'
      },
      body: fs.createReadStream(absolutePath, { start, end })
    }, (error, response, body) => {
      if (error) {
        debug(`postResource error: ${error}`)
      }
    })
  }
  /**
   * get resource (store)
   * @memberof Pipe
   */
  getResource (message) {
    return request({
      uri: getURL(this.ctx.deviceSN, message.sessionId, false),
      method: 'GET',
      headers: { Authorization: this.ctx.config.cloudToken }
    })
  }
}

module.exports = Pipe
