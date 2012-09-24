'use strict';
/*global require:false */

var Class = require( 'class' ).Class;
var sf = require( 'sf' );
var fs = require( 'fs' );
var _ = require( 'underscore' );
var SignatureRequest = require( './lib/sigrequest' );

var AvocadoJS = new Class({

  apiEndpoint: 'https://avocado.io/api',

  constructor: function (config) {
    if ( !config ) {
      throw new Error( 'You need an API Key, dev key, email and password' );
    }

    this.request = require( 'request' );
    this.config = config;
    this.loggedIn = false;
    this.cookieJar = null;
  },

  login: function (callback) {
    var self = this;
    var sigRequest = new SignatureRequest( this.config );
    
    sigRequest.on( 'io.avocado.request.success', function (data) {
      self.config.signature = sigRequest.config.signature;
      self.config.cookieValue = sigRequest.config.cookieValue;
      self.cookieJar = self.request.jar();
      var cookieStr = 'user_email=' + sigRequest.config.cookieValue + ';';
      var cookie = self.request.cookie( cookieStr );
      self.cookieJar.add( cookie );

      try {
        data = JSON.parse( data );
        self.loggedIn = true;
        if ( typeof data === 'string' ) {
          return callback( new Error( data ) );
        }
        return callback( null, data );
      } catch ( e ) {
        return callback( e );
      }
    });

    sigRequest.on( 'io.avocado.request.error', function (err) {
      return callback( new Error( err ) );
    });

    sigRequest.send();
  },

  _performRequest: function (opts, formData, callback) {
    var self = this;
    var media;
    var caption;

    if ( !this.loggedIn ) {
      return callback( new Error( 'You must be logged in to complete this request!' ) );
    }

    var url = this.apiEndpoint + opts.path;

    if ( ( !opts.method || opts.method === 'get' ) && formData ) {
      url = this._buildUrl( this.apiEndpoint, opts.path, formData );
    }

    if ( formData.media ) {
      media = formData.media;
      caption = formData.caption || '';
      formData = {};
    }

    var r = self.request({
      method: opts.method,
      jar: self.cookieJar,
      form: formData,
      url: url,
      headers: {
        'X-AvoSig': self.config.signature,
        'User-Agent': 'Avocado Node Api Client v.1.0'
      }
    }, function (err, response, body) {
      return callback(err, response, body);
    });

    if ( media ) {
      var form = r.form();
      form.append( 'media', media );
      form.append( 'caption', caption );
    }
  },

  _send: function (opts, params, callback) {
    var _404= 'Not Found';
    var _400 = 'Missing Data';
    var msg;
    params = params || {};
    params = _.extend( params, this._getStdSigParams() );

    function onRequestComplete ( err, response, body ) {
      
      if ( err ) {
        return callback( err );
      }
      
      if ( response.statusCode === 404 ) {
        msg = opts._404 || _404;
        return callback( new Error( msg ) );
      }

      if ( response.statusCode === 400 ) {
        msg = opts._400 || _400;
        return callback( new Error( msg ) );
      }

      var obj;
      try {
        obj = JSON.parse( body );
      } catch ( e ) {
        return callback( new Error( sf( 'Response from server: {0}', body ) ) );
      }

      return callback( null, obj );
    }

    return this._performRequest( opts, params, onRequestComplete );
  },

  _buildUrl: function (endpoint, path, params) {
    var base = endpoint + path;
    if (params) {
      base += '?';

      for (var p in params) {
        base += p + '=' + params[p] + '&';
      }
    }
    if (base[base.length - 1] === '&') {
      base = base.substring(0, base.length - 1);
    }
    return base;
  },

  _getStdSigParams: function () {
    return {
      avosig: this.config.signature
    };
  },

  upload: function (path, caption, callback) {
    var self = this;
    caption = caption || '';
    path = require( 'path' ).resolve( path );
    fs.exists( path, function (exists) {
      if ( !exists ) {
        return callback( new Error( sf( "Media '{0}' does not exist", path ) ) );
      }

      var buff = fs.readFileSync( path );
      self._send({
        path: '/media/',
        method: 'post'
      }, {
        caption: caption,
        media: fs.createReadStream( path )
      }, callback);
    });
  },

  getMedia: function (params, callback) {
    params = params || { before: Date.now() };
    return this._send({
      path: '/media/'
    }, params, callback);
  },

  deleteMedia: function (id, callback) {
    return this._send({
      path: sf( '/media/{0}/delete/', id ),
      method: 'post',
      _404: sf( 'Could not find the item with the given ID {0}', id )
    }, {}, callback);
  },

  createList: function (name, callback) {
    return this._send({
      path: '/lists/',
      _400: 'List name not provided',
      method: 'post'
    }, {
      name: name
    }, callback);
  },

  getLists: function (callback) {
    return this._send({
      path: '/lists/'
    }, {}, callback);
  },

  renameList: function (name, id, callback) {
    return this._send({
      path: sf( '/lists/{0}/', id ),
      _404: 'The list was not found',
      _400: 'The list name was not supplied',
      method: 'post'
    }, {
      name: name
    }, callback);
  },

  getList: function (id, callback) {
    return this._send({
      path: sf( '/lists/{0}/', id ),
      medhod: 'get'
    }, {}, callback);
  },

  deleteListItem: function (listId, itemId, callback) {
    return this._send({
      path: sf( '/lists/{0}/{1}/delete/', listId, itemId ),
      _404: 'The list item was not found',
      method: 'post'
    }, {}, callback);
  },

  deleteList: function (listId, callback) {
    return this._send({
      path: sf( '/lists/{0}/delete/', listId ),
      _404: 'The list was not found',
      method: 'post'
    }, {}, callback);
  },

  editListItem: function (listId, itemId, params, callback) {
    return this._send({
      path: sf( '/lists/{0}/{1}', listId, itemId ),
      _404: 'The list or list item was not found',
      _400: 'The index was out of bounds, or no edits were specified',
      method: 'post'
    }, params, callback);
  },

  createListItem: function (id, itemText, callback) {
    return this._send({
      path: sf( '/lists/{0}/', id ),
      _404: 'The list was not found!',
      _400: 'The new list item was not supplied!',
      method: 'post'
    }, {
      text: itemText
    }, callback);
  },

  logout: function(callback) {
    var self = this;
    return this._send({
      path: '/authentication/logout/'
    }, {}, function (err, body) {
      self.isLoggedIn = false;
      return callback( err, body );
    });
  },

  getCouple: function (callback) {
    return this._send({
      path: '/couple/'
    }, {}, callback);
  },

  sendMessage: function(text, callback) {
    this._send({
      path: '/conversation/',
      _404: 'Empty or otherwise bad-news message',
      method: 'post'
    }, {
      message: text
    }, callback);
  },

  // TODO change to getRecentActivities
  getActivities: function (opts, callback) {
    if ( opts.before && opts.after ) {
      return callback( new Error('You cannot specifiy both before and after times.') );
    }
    return this._send({
      path: '/activities/'
    }, opts, callback);
  },

  deleteActivity: function (id, callback) {
    return this._send({
      path: sf( '/activities/{0}/delete/', id ),
      method: 'post',
      _404: sf( 'ID {0} was not found!', id )
    }, {}, callback);
  },

  getCurrentUsers: function (callback) {
    return this._send({
      path: '/user/'
    }, {}, callback);
  },

  getUser: function (id, callback) {
    return this._send({
      path: sf( '/user/{0}/', id )
    }, {}, callback);
  }

});

module.exports = AvocadoJS;