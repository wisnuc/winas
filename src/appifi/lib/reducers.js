const { createStore, combineReducers } = require('./redux')

const Debug = require('debug')
const REDUCERS = Debug('APPIFI:REDUCERS')

const developer = (state = {}, action) => {

  switch(action.type) {
    case 'DEVELOPER_SETTING':
      state[action.key] = action.value
      return state 
    default:
      return state
  }
}

const docker = (state = null, action) => {

  let newState

  switch(action.type) {
    case 'DAEMON_START':
      newState = {
        volume: action.data.volume,
        events: action.data.events,
        data: null,
        computed: null
      }
      break

    case 'DOCKER_UPDATE':
      newState = Object.assign({}, state, action.data)
      break

    case 'DAEMON_STOP': 
      newState = null
      break

    default: 
      newState = state
      break
  }
  
  return newState
}

const tasks = (state = [], action) => {

  switch(action.type) {
    case 'TASK_ADD': {
      action.task.on('update', () => {
        store.dispatch({
          type: 'TASK_UPDATE'
        })  
      })
      action.task.on('end', () => {
        store.dispatch({
          type: 'TASK_UPDATE'
        })
      })
      return [...state, action.task]
    }

    case 'TASK_REMOVE':
      let index = state.findIndex(t => t.type === action.task.type && t.id === action.task.id)
      if (index === -1) {
        REDUCERS(`ERROR: TASK_REMOVE, task not found, type: ${action.task.type}, id: ${action.task.id}`)
        return state 
      }
      return [...state.slice(0, index), ...state.slice(index + 1)]

    default:
      return state
  }
} 

const appstore = (state = null, action) => {

  switch(action.type) {
    case 'APPSTORE_UPDATE':
      return action.data 

    default:
      return state
  }
}

const increment = (state = 0, action) => {

  switch(action.type) {
    case 'TASK_UPDATE':
      return state++

    default:
      return state
  }
}

let store = createStore(combineReducers({
  increment,
  developer,
  docker,
  appstore,
  tasks,
}))

REDUCERS(`Module initialized`)

const storeState = () => store.getState()
const storeDispatch = (action) => store.dispatch(action)
const storeSubscribe = (listener) => store.subscribe(listener)

module.exports = {
  storeState,
  storeDispatch,
  storeSubscribe
}

// export const testing = { store }

