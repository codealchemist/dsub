const fs = require('fs')
const EventEmitter = require('events')
const elapsedTime = require('elapsed-time')
const mkdirp = require('mkdirp')
const request = require('request')
const gunzip = require('gunzip-file')
const series = require('run-series')
const opensubtitles = require('subtitler')

class Dsub extends EventEmitter {
  constructor ({name, src, dest, lang = 'spa', noExtract = false, timeout = 5000, debug, ignore}) {
    super()
    this.name = name
    this.src = src
    this.dest = dest
    this.lang = lang
    this.noExtract = noExtract
    this.timeout = timeout
    this.debug = debug
    this.ignore = ignore
  }

  getVideoFiles (src, callback) {
    fs.readdir(src, (err, files) => {
      if (!fs.existsSync(src)) {
        throw new Error(`Sorry, I can't read this path:`, src)
      }
      if (err) throw err

      files = files.filter(
        file => file.match(/(.avi|.mp4|.mkv|.mpg|.mpeg|.ogg|.ogv|.webm|.3gp|.mov|.mp2|.wmv)$/)
      )
      if (this.ignore) {
        const regex = new RegExp(this.ignore, 'i')
        files = files.filter(file => !file.match(regex))
      }
      callback(files)
    })
  }

  noVideos () {
    let src = this.src
    if (src === '.') src = 'current directory'
    this.log(`
      Oops... There are no video files in ${src}.
    `)
    process.exit()
  }

  search (file, callback) {
    this.emit('searching', {file})

    // First, we need to login to the subtitles service.
    opensubtitles.api.login()
      .then(
        (token) => {
          // this.log('Login ok:', token)
          this.emit('login', {file, token})

          // Search subtitles.
          opensubtitles.api.search(token, this.lang, {
            query: file
          })
          .then(
            (results) => callback(null, results),
            (err) => callback(err)
          )
        },
        (err) => {
          this.log('Search error: unable to login.', err)
          this.emit('error', err)
        }
      )
  }

  download () {
    this.timer = elapsedTime.new().start()

    // Search subs for passed movie name.
    if (this.name) {
      this.search(this.name, (err, results) => {
        if (err) {
          this.emit('error', {err, type: 'search'})
          return
        }

        this.downloadSubs({file: this.name, results})
      })
      return
    }

    // Search subs for all video files in folder.
    this.getVideoFiles(this.src, (files) => {
      if (!files.length) this.noVideos()

      // Ensure subs folder exists.
      mkdirp(this.dest, (err) => {
        if (err) {
          throw new Error(`ERROR: Unable to create path: ${this.dest}`, err)
        }
      })

      const tasks = []
      files.map((file) => {
        tasks.push((done) => {
          this.search(file, (err, results) => {
            if (err) {
              this.emit('error', {err, type: 'search'})
              return done({err, type: 'search'})
            }

            this.downloadSubs({file, results, done})
          })
        })
      })

      series(tasks, (err, results) => {
        this.log('-'.repeat(80))
        this.log('ALL DONE:', results)
        this.log('-'.repeat(80))

        if (err) {
          this.log('ERRORS:', err)
          this.emit('error', err)
        }

        this.emit('done', {
          totalFiles: results.length,
          totalSubs: results.reduce((sum, result) => sum + result.total, 0),
          time: this.timer.getValue()
        })
      })
    })
  }

  /**
   * Download all subtitles found after doing a search.
   * Emits:
   *   - empty: When no subs were found.
   *   - downloading: When downloading subs.
   *   - done: After all subs were processed (can be a successfull download or not).
   *
   * @param  {string} options.file
   * @param  {array} options.results Search results.
   */
  downloadSubs ({file, results, done}) {
    let total = results.length
    let current = 0
    let totalOk = 0
    const subsFiles = []
    const failedFiles = []
    if (total < 1) {
      this.emit('empty', {file})
      return done(null, {file, total: 0})
    }

    this.emit('downloading', {file, total})
    results.map((subtitle) => {
      ++current
      const targetFile = `${this.dest}/${file}-${current}.gz`
      const writer = fs.createWriteStream(targetFile)
      const stream = request({timeout: this.timeout, url: subtitle.SubDownloadLink})
        .on('error', (err) => {
          this.log(`ERROR requesting file: ${targetFile}`)
          --total
          failedFiles.push(targetFile)
          if (total < 1) this.onFinishDownloading({file, subsFiles, failedFiles, totalOk, done})
          stream.end()
          throw err
        })
        .pipe(writer)
        .on('error', (err) => {
          this.log(`ERROR writing file: ${targetFile}`)
          --total
          failedFiles.push(targetFile)
          if (total < 1) this.onFinishDownloading({file, subsFiles, failedFiles, totalOk, done})
          stream.end()
          throw err
        })
        .on('finish', () => {
          // The stream will finish even when errors ocurr.
          // Avoid processing failed downloads.
          // Delete invalid files.
          if (failedFiles.indexOf(targetFile) !== -1) {
            this.log('== FAILED:', targetFile)
            return
          }

          --total
          ++totalOk
          this.emit('downloading', {file, total})
          subsFiles.push({file: targetFile, format: subtitle.SubFormat})
          this.log(`File written OK: ${targetFile}`)

          // All downloaded!
          if (total < 1) {
            this.onFinishDownloading({file, subsFiles, failedFiles, totalOk, done})
          }
        })
    })
  }

  onFinishDownloading ({file, subsFiles, failedFiles, totalOk, done}) {
    this.cleanupFailed(failedFiles)

    // No need to extract, we're done.
    if (this.noExtract) {
      this.emit('partial', {
        file,
        total: totalOk,
        time: this.timer.getValue()
      })
      return done(null, {file, total: totalOk})
    }

    // Extract subs before calling it a night.
    this.extract({file, subsFiles, done})
  }

  extract ({file, subsFiles, done}) {
    this.log('extract', file)
    let total = subsFiles.length
    let totalOk = 0
    this.emit('extracting', {file, total})

    subsFiles.map((subsFile) => {
      const targetFile = subsFile.file.replace('.gz', `.${subsFile.format}`)

      gunzip(subsFile.file, targetFile, (err) => {
        --total
        this.emit('extracting', {file, total})

        if (!err) ++totalOk
        if (total < 1) this.cleanup({file, subsFiles, totalOk, done})
      })
    })
  }

  cleanupFailed (failedFiles) {
    this.log('cleanup failed', failedFiles)
    failedFiles.map(file => fs.unlinkSync(file))
  }

  /**
   * Delete compressed files.
   *
   */
  cleanup ({file, subsFiles, totalOk, done}) {
    this.log('cleanup', file)
    let total = subsFiles.length
    this.emit('cleanup', {file, total})

    subsFiles.map((subsFile) => {
      fs.unlink(subsFile.file, () => {
        --total
        if (total < 1) {
          this.emit('partial', {
            file,
            total: subsFiles.length,
            time: this.timer.getValue()
          })
          done(null, {file, total: totalOk})
        }
      })
    })
  }

  log () {
    if (!this.debug) return
    console.log(...arguments)
  }
}

module.exports = Dsub
