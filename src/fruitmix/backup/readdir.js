const path = require('path')
const fs = require('fs')
const fileAttr = require('./file-attr')
const { readXstat } = require('../../lib/xstat')

const readdir = (dirPath, uuid, mtime, callback) => {
  // guard
  let destroyed = false

  readXstat(dirPath, (err, x1) => {
    if (destroyed) return 
    if (err) return callback(err)
    if (x1.type !== 'directory') {
      callback(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }))
    } else if (x1.uuid !== uuid) {
      callback(Object.assign(new Error('uuid mismatch'), { code: 'EINSTANCE' }))
    } else if (mtime && x1.mtime === mtime) {
      callback(null, null)
    } else {
      fs.readdir(dirPath, (err, entries) => {
        if (destroyed) return
        if (err) return callback(err)
        if (entries.length === 0)  {
          readXstat(dirPath, (err, x2) => {
            if (destroyed) return
            if (err) return callback(err)
            if (x2.type !== 'directory') {
              callback(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }))
            } else if (x2.uuid !== uuid) {
              callback(Object.assign(new Error('uuid mismatch'), { code: 'EINSTANTCE' }))
            } else {
              callback(null, [], x2.mtime, x2.mtime !== x1.mtime)
            }
          })
        } else {
          let prenames = entries.sort()
          let attrFiles = []
          let names = []
          let whiteout = undefined
          for (let i = 0; i < prenames.length; i ++ ) {
            if (prenames[i].startsWith('.xattr.')) 
              attrFiles.push(prenames[i])
            else if (prenames[i].startsWith('.whiteout'))
              whiteout = prenames
            else 
              names.push(prenames[i])
          }
          let running = 0
          let xstats = []

          let done = () => readXstat(dirPath, (err, x2) => {
            if (destroyed) return
            if (err) return callback(err)
            if (x2.type !== 'directory') {
              callback(Object.assign(new Error('not a directory'), { code: 'ENOTDIR' }))
            } else if (x2.uuid !== uuid) {
              callback(Object.assign(new Error('uuid mismatch'), { code: 'EINSTANCE' }))
            } else {
              fileAttr.readWhiteout(dirPath, (err, data) => {
                // convert bname => name
                if (Array.isArray(data)) data.forEach(d => d.name = d.bname)
                let obj = { living: xstats, whiteout: data || [] }
                callback(null, obj, x2.mtime, x2.mtime !== x1.mtime)
              })
            }
          })
          const schedule = () => {
            while (names.length > 0 && running < 16) {
              let name = names.shift()
              let goon = () => {
                if (--running || names.length) {
                  schedule() 
                } else 
                  done()
              }
              fs.lstat(path.join(dirPath, name), (err, lstat) => {
                if (destroyed) return
                if (!err && (lstat.isDirectory() || lstat.isFile())) { // skip
                  if (lstat.isDirectory()) {
                    readXstat(path.join(dirPath, name), (err, x2) => {
                      if (destroyed) return
                      if (!err) xstats.push(x2) 
                      goon()
                    })
                  } else {
                    let attrName = '.xattr.' + name
                    let index = attrFiles.findIndex(x => x === attrName)
                    if (index !== -1) {
                      fileAttr.readFileXstats(dirPath, name, (err, x2) => {
                        if (destroyed) return
                        if (!err) {
                          x2.forEach(x => x.hash = name)
                          xstats.push(...x2)
                        }
                        goon()
                      })
                    } else
                      goon()
                  }
                }
                else
                  goon()
              })
              running++
            }
          }
          schedule()
        }
      })   
    }
  })

  return {
    path: dirPath,
    destroy: () => destroyed = true
  } 
}

module.exports = readdir
