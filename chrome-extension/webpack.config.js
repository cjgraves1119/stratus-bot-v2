const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const webpack = require('webpack');
const { renderManifestForTarget, resolveBuildTarget } = require('./release-targets.cjs');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  const profile = resolveBuildTarget(env && env.target);

  return {
    entry: {
      background: './src/background/index.js',
      content: './src/content/index.js',
      'zoho-content': './src/content/zoho-content.js',
      sidebar: './src/sidebar/index.jsx',
      popup: './src/popup/index.jsx',
      options: './src/options/index.jsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].bundle.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: { chrome: '114' } }],
                ['@babel/preset-react', { runtime: 'automatic' }],
              ],
            },
          },
        },
        {
          test: /\.css$/,
          oneOf: [
            // Content script CSS — extract to separate file
            {
              include: path.resolve(__dirname, 'src/content'),
              use: [MiniCssExtractPlugin.loader, 'css-loader'],
            },
            // Everything else — inline
            {
              use: ['style-loader', 'css-loader'],
            },
          ],
        },
      ],
    },
    plugins: [
      // The named target resolves API, environment, branding, host permissions,
      // and update behavior as one reviewed unit. There are no independent
      // gateway or branding overrides.
      new webpack.DefinePlugin({
        STRATUS_API_BASE: JSON.stringify(profile.apiBase),
        STRATUS_ENV: JSON.stringify(profile.stratusEnv),
      }),
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new CopyPlugin({
        patterns: [
          {
            from: 'manifest.json',
            to: 'manifest.json',
            transform(content) {
              return Buffer.from(renderManifestForTarget(content.toString('utf8'), profile));
            },
          },
          { from: 'src/icons', to: 'icons', noErrorOnMissing: true },
          { from: 'src/content/content.css', to: 'content.css' },
          { from: 'public/stratus-cart-core.js', to: 'stratus-cart-core.js' },
          { from: 'public/stratus-cart-popup.js', to: 'stratus-cart-popup.js' },
          { from: 'public/stratus-task-email-optin.js', to: 'stratus-task-email-optin.js' },
        ],
      }),
      new HtmlWebpackPlugin({
        template: './public/sidebar.html',
        filename: 'sidebar.html',
        chunks: ['sidebar'],
      }),
      new HtmlWebpackPlugin({
        template: './public/popup.html',
        filename: 'popup.html',
        chunks: ['popup'],
      }),
      new HtmlWebpackPlugin({
        template: './public/options.html',
        filename: 'options.html',
        chunks: ['options'],
      }),
    ],
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    optimization: {
      minimizer: [
        '...',
        new CssMinimizerPlugin(),
      ],
    },
    // Source maps are retained only for the historical snapshot comparison.
    // Distribution targets are sanitized and must never contain source maps.
    devtool: profile.name === 'snapshot-dev'
      ? (isProd ? 'source-map' : 'cheap-module-source-map')
      : false,
  };
};
