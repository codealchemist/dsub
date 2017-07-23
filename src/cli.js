#!/usr/bin/env node
// const path = require('path') // TODO: Remove unused code.
const args = require('minimist')(process.argv.slice(2))
const printii = require('printii')(__dirname)
const ora = require('ora')
const chalk = require('chalk')
const Dsub = require('./')

const lang = args.lang || 'spa'
const src = args.src || '.'
const dest = args.dest || './subs'
const noExtract = args.noExtract
const name = args.name
const debug = args.debug
const ignore = args.ignore

printii()

const errors = []
const spinner = ora().start()
const dsub = new Dsub({name, src, dest, lang, noExtract, debug, ignore})
dsub
  .on('searching', ({file}) => {
    spinner.text = `Searching ${chalk.white(lang)} subs for: ${chalk.blue(file)}`
  })
  .on('login', ({file, token}) => {
    spinner.text = `Searching ${chalk.white(lang)} subs for: ${chalk.blue(file)} ${chalk.dim('// Logged in.')}`
  })
  .on('downloading', ({file, total}) => {
    spinner.text = `Downloading ${chalk.white(total)} subs for: ${chalk.blue(file)}`
  })
  .on('extracting', ({file, total}) => {
    spinner.text = `Extracting ${chalk.white(total)} subs for: ${chalk.blue(file)}`
  })
  .on('cleanup', ({file, total}) => {
    spinner.text = `Cleaning up ${chalk.white(total)} subs for: ${chalk.blue(file)}`
  })
  .on('partial', ({time, total, file}) => {
    spinner.text = `${chalk.white(total)} subs downloaded for: ${chalk.blue(file)}\n`
  })
  .on('done', ({time, totalFiles, totalSubs}) => {
    let filesStr = 'files'
    if (totalFiles === 1) filesStr = 'file'

    spinner.succeed(
      `Downloaded ${chalk.white(totalSubs)} subtitles for ` +
      `${chalk.white(totalFiles)} ${filesStr} in ${chalk.blue(time)}.\n`
    )

    if (!errors.length) return
    if (args.verbose) {
      console.error(`${chalk.red(errors.length)} errors occurred.`)
      errors.map((error) => {
        console.log('-'.repeat(80))
        console.error(error)
      })
    }
  })
  .on('empty', ({file}) => {
    spinner.fail(`No subtitles found for ${file}.\n`).start()
  })
  .on('error', (error) => {
    console.error('Oops, the following error occurred:', error)
    process.exit()
  })
  .download()

process.on('uncaughtException', (err) => {
  errors.push(err)
})
