const Promise = require('bluebird')
const fs = Promise.promisifyAll(require('fs'))
const child = Promise.promisifyAll(require('child_process'))
const mkdirpAsync = Promise.promisify(require('mkdirp'))
const rimrafAsync = Promise.promisify(require('rimraf'))
const debug = require('debug')('samba')

/**
retrieve linux users from /etc/passwd
*/
const retrieveSysUsersAsync = async () => {
  let data = await fs.readFileAsync('/etc/passwd')
  return data.toString().split('\n')
    .map(l => l.trim())
    .filter(l => l.length)
    .map(l => {
      let split = l.split(':')
      if (split.length !== 7) return null
      return {
        name: split[0],
        id: parseInt(split[2])
      }
    })
    .filter(u => !!u)
    .filter(u => /^x[0-9a-f]{31}$/.test(u.name)) // 31位长度的用户名是NAS用户对应UUID
}

/**
retrieve smb users using pdbedit
*/
const retrieveSmbUsersAsync = async () => {
  let stdout = await child.execAsync('pdbedit -Lw')
  return stdout.toString().split('\n')
    .map(l => l.trim())
    .filter(l => l.length)
    .map(l => {
      let split = l.split(':')
      if (split.length !== 7) return null
      return {
        name: split[0],
        uid: parseInt(split[1]),
        md4: split[3],
        lct: split[5]
      }
    })
    .filter(u => !!u)
}


// this function
// 1. sync /etc/passwd,
// 2. sync smb passwd db,
// 3. generate user map
// returns users
const processUsersAsync = async _users => {
  // filter out users without smb password
  users = _users.filter(u => !!u.smbPassword)

  // 获取与本地用户对于的系统用户列表
  let sysUsers = await retrieveSysUsersAsync()
  debug('get system users\n')
  debug(sysUsers)

  // 将系统用户删除
  let outdated = sysUsers.filter(su => !users.find(fu => fu.unixName === su.name))
  for (let i = 0; i < outdated.length; i++) {
    try {
      await child.execAsync(`deluser ${outdated[i].name}`)
    } catch (e) {
      console.log(`error deleting user ${outdated[i].name}`)
    }
  }

  debug('after remove system users')

  // 将本地用户添加至系统用户
  let newNames = users
    .filter(fu => !sysUsers.find(su => su.name === fu.unixName))
    .map(fu => fu.unixName)

  for (let i = 0; i < newNames.length; i++) {
    try {
      let cmd = 'adduser --disabled-password --disabled-login --no-create-home --gecos ",,," ' +
        `--gid 65534 ${newNames[i]}`
      await child.execAsync(cmd)
    } catch (e) {
      console.log(`error adding user ${newNames[i]}`)
    }
  }

  debug('after add system users')

  // 将新生成的系统用户ID赋予本地用户
  sysUsers = await retrieveSysUsersAsync()
  users = users.reduce((acc, fu) => {
    let su = sysUsers.find(su => su.name === fu.unixName)
    if (su) {
      fu.unixUID = su.id
      acc.push(fu)
    }
    return acc
  }, [])

  // 获取现有的samba用户
  let smbUsers = await retrieveSmbUsersAsync()

  debug('get samba users')
  debug(smbUsers)

  // 删除现有的samba用户
  for (let i = 0; i < smbUsers.length; i++) {
    try {
      await child.execAsync(`pdbedit -x ${smbUsers[i].name}`)
    } catch (e) {
      console.log(`error deleting smb user ${smbUsers[i].name}`)
    }
  }

  debug('after remove samba user')

  // 创建samba用户
  let text = users
    .map(u => {
      return [
        `${u.unixName}`,
        `${u.unixUID}`,
        'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        `${u.smbPassword.toUpperCase()}`,
        '[U          ]',
        `LCT-${Math.floor(u.lastChangeTime / 1000).toString(16).toUpperCase()}`
      ].join(':')
    })
    .join('\n')

  await mkdirpAsync('/run/wisnuc/smb')
  await fs.writeFileAsync('/run/wisnuc/smb/tmp', text)
  await child.execAsync('pdbedit -i smbpasswd:/run/wisnuc/smb/tmp')
  await rimrafAsync('/run/wisnuc/smb')

  debug('after create samba user')

  // creat user map
  text = users
    .map(u => `${u.unixName} = "${u.phoneNumber}"`)
    .join('\n')

  await fs.writeFileAsync('/etc/smbusermap', text)
  return users
}

// smb.conf global section
const globalSection = `
[global]
  username map = /etc/smbusermap
  workgroup = WORKGROUP
  netbios name = SAMBA
  map to guest = Bad User
`

const priviledgedShare = share => `

[${share.name}]
  path = ${share.path}
  browseable = yes
  guest ok = no
  read only = no
  force user = root
  force group = root
  write list = ${share.writelist.join(', ')}
  valid users = ${share.writelist.join(', ')}
  vfs objects = full_audit
  full_audit:prefix = %u|%U|%S|%P
  full_audit:success = create_file mkdir rename rmdir unlink write pwrite
  full_audit:failure = connect
  full_audit:facility = LOCAL7
  full_audit:priority = ALERT
`

const anonymousShare = share => `

[${share.name}]
  path = ${share.path}
  browseable = yes
  guest ok = yes
  read only = no
  force user = root
  force group = root
  vfs objects = full_audit
  full_audit:prefix = %u|%U|%S|%P
  full_audit:success = create_file mkdir rename rmdir unlink write pwrite
  full_audit:failure = connect
  full_audit:facility = LOCAL7
  full_audit:priority = ALERT
`

const usbShare = usb => `

[usb.${usb.name}]
  path = ${usb.mountpoint}
  browseable = yes
  guest ok = yes
  read only = ${usb.readOnly ? 'yes' : 'no'}
  force user = root
  force group = root
`

const genSmbConfAsync = async (shares, usbs) => {
  let text = globalSection
  shares.forEach(share => text += share.anonymous 
    ? anonymousShare(share) 
    : priviledgedShare(share))
  usbs.forEach(usb => text += usbShare(usb))
  await fs.writeFileAsync('/etc/samba/smb.conf', text)
}

module.exports = {
  rsyslogAsync,
  processUsersAsync,
  genSmbConfAsync
}
