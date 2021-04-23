const dts = require('dts-bundle')

const opts = {
  name: 'zact',
  main: './lib/index.d.ts',
  out: './types/index.d.ts',
  externals: false,
  indent: '  ',
  verbose: true,
}

// run it
dts.bundle(opts)
