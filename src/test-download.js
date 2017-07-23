// const dsub = require('./')
const url = 'http://s2.quickmeme.com/img/42/4266c634657917c478869b4ad421c378b91162ac16d15aaa901621f201692a7d.jpg'

const fs = require('fs')
const mkdirp = require('mkdirp')
const request = require('request')

const path = './tmp'
const writer = fs.createWriteStream(`${path}/file.jpg`)
writer
  .on('finish', () => {
    console.log('DONE!')
  })
  .on('error', (err) => {
    console.error('ERROR writing file:', err)
  })

mkdirp(path, (err) => {
  if (err) {
    console.error('ERROR: Unable to create directory:', path)
    process.exit()
  }
})
request(url).pipe(writer)
