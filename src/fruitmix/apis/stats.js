// This list must be kept in sync with that in file meta

const ImageTypes = ['JPEG', 'PNG', 'GIF', 'BMP', 'TIFF']
const VideoTypes = ['RM', 'RMVB', 'WMV', 'AVI', 'MPEG', 'MP4', '3GP', 'MOV', 'FLV', 'MKV']
const AudioTypes = ['RA', 'WMA', 'MP3', 'OGG', 'MKA', 'WAV', 'APE', 'FLAC']
const DocTypes = ['DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'PDF']

class Stats {
  constructor (vfs) {
    this.vfs = vfs
  }

  GET (user, props, callback) {
    let image = { count: 0, totalSize: 0 }
    let video = { count: 0, totalSize: 0 }
    let audio = { count: 0, totalSize: 0 }
    let document = { count: 0, totalSize: 0 }
    let others = { count: 0, totalSize: 0 }

    let map = this.vfs.forest.fileMap     
    for (const [uuid, file] of map) {
      let type = file.metadata && file.metadata.type
      if (ImageTypes.includes(type)) {
        image.count++
        image.totalSize += file.size
      } else if (VideoTypes.includes(type)) {
        video.count++
        video.totalSize += file.size
      } else if (AudioTypes.includes(type)) {
        audio.count++
        audio.totalSize += file.size
      } else if (DocTypes.includes(type)) {
        document.count++
        document.totalSize += file.size
      } else {
        // others.count++
      }
    }
    let totalSize = 0
    let totalCount = 0
    Array.from(this.vfs.forest.roots.values()).forEach(x => {
      let stats = x.stats()
      totalSize += stats.fileTotalSize || 0
      totalCount += stats.fileCount || 0
    })
    others.totalSize = totalSize - image.totalSize - video.totalSize - audio.totalSize - document.totalSize
    others.count = totalCount - image.count - video.count - audio.count - document.count // fix others count
    others.totalSize = others.totalSize > 0 ? others.totalSize : 0
    process.nextTick(() => callback(null, { image, video, audio, document, others }))
  }
}

module.exports = Stats
