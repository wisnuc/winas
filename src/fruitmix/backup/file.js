const File = require('../vfs/file')
const debug = require('debug')('wis:backup-file')
const path = require('path')

class BFile extends File {
  
  constructor (ctx, parent, xstat) {
    super(ctx, parent, xstat)
    this.archived = xstat.archived
    this.bctime = xstat.bctime
    this.bmtime = xstat.bmtime
    this.bname = xstat.bname
    this.otime = xstat.otime
  }
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