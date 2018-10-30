const child = require('child_process')
const Debug = require('debug')
const SERVER = Debug('APPIFI:SERVER')

const { storeState, storeSubscribe } = require('./reducers')
const { calcRecipeKeyString } = require('./utility')
const {
  daemonStart,
  daemonStop,
  daemonStartOp,
  containerStart,
  containerStop,
  containerDelete,
  installedStart,
  installedStop,
  appInstall,
  appUninstall
} = require('../component/docker/docker')

const { refreshAppstore } = require('../component/appstore/appstore')

let status = 0

storeSubscribe(() => {
  status++
  SERVER('Status update', status)
})

const appstoreFacade = (appstore) => {

  if (appstore === null) return null
  if (appstore.status === 'LOADING') 
    return { status: 'LOADING' }

  if (appstore.status === 'ERROR')
    return { status: 'ERROR', code: appstore.code, message: appstore.message }

  let { recipes, repoMap } = appstore.result
  if (!repoMap) {
    return {
      status: 'LOADED',
      result: recipes
    }
  }

  // be careful. if recipes are cloned first, then cloned 
  // recipes' components won't be the key in the map any more !!!

  let appended = []

  recipes.forEach(recipe => {

    let components = []
    recipe.components.forEach(compo => {
      let repo = repoMap.get(compo)
      if (repo === undefined) repo = null
      components.push(Object.assign({}, compo, {repo}))
    })
    appended.push(Object.assign({}, recipe, {components}))
  }) 

  appended.forEach(recipe => recipe.key = calcRecipeKeyString(recipe)) 
  return {
    status: 'LOADED',
    result: appended
  }
}

const installedFacades = (installeds) => {

  if (!installeds) return null

  let facade = installeds.map(inst => Object.assign({}, inst, {
    container: undefined,
    containerIds: inst.containers.map(c => c.Id) 
  }))

  // remove containers property, dirty, is there a better way ??? TODO
  facade.forEach(f => f.containers = undefined)
  return facade
}

const dockerFacade = (docker) => {
  
  if (!docker) return null
  
  let facade = {}
  // facade.pid = docker.pid
  facade.volume = docker.volume
  
  if (docker.data) {
    facade = Object.assign({}, facade, docker.data, { 
      installeds: installedFacades(docker.computed.installeds)
    })
  }

  return facade
}

const tasksFacade = (tasks) => {

  if (!tasks || !tasks.length) return [] 
  return tasks.map(t => t.facade())
}

const facade = () => {

  return {
    status,
    device: storeState().device,
    boot: storeState().boot,
    config: storeState().config,
    developer: storeState().developer,
    storage: storeState().storage,
    docker: dockerFacade(storeState().docker),
    appstore: appstoreFacade(storeState().appstore),
    tasks: tasksFacade(storeState().tasks),
  } 
}
  
const operationAsync = async (req) => {

  SERVER(`Operation: ${req.operation}`)

  let f, args

  if (req && req.operation) {
    
    args = (req.args && Array.isArray(req.args)) ? req.args : []

    switch (req.operation) {
    case 'daemonStart':
      f = daemonStartOp
      break 
    case 'daemonStop':
      f = daemonStop
      break
    case 'containerStart':
      f = containerStart
      break
    case 'containerStop':
      f = containerStop
      break
    case 'containerDelete':
      f = containerDeleteCommand
      break
    case 'installedStart':
      f = installedStart
      break
    case 'installedStop':
      f = installedStop
      break
    case 'appInstall':
      f = appInstall
      break
    case 'appUninstall':
      f = appUninstall
      break
    case 'appstoreRefresh':
      f = refreshAppstore
      break

    default:
      SERVER(`Operation not implemented, ${req.operation}`)
    }
  }

  if (f) {
    return await f(...args)
  }
  
  return null
}

module.exports = {

  status: () => {
    return { status }
  },

  get: () => {
    let f = facade()
    return f
  },

  operation: (req, callback) => {
    operationAsync(req)
      .then(r => callback(null)) 
      .catch(e => callback(e))
  }
}

// // docker init
// initDocker.init('/home/wisnuc/git/appifi/run/wisnuc/app')
// SERVER('Docker initialized')
