const File = require('../vfs/file')
const debug = require('debug')('ws:backup-file')
const path = require('path')

class BFile extends File {
  /**
    @rewrite 
  */
 abspath() { 
  if (!this.ctx) throw new Error('node.abspath: node is already destroyed')
  let q = [] 
  for (let n = this.parent; n !== null; n = n.parent) q.unshift(n)
    return path.join(this.ctx.dir, ...q.map(n => n.name), this.hash)
  }
}

module.exports = BFile