const fs = require('fs')
const unzip = require('unzip')

const file = './tmp/subs.gz'
fs.createReadStream(file)
  .pipe(unzip.Extract({ path: '.tmp/subs.srt' }))
