/*
 * client.js: Base client from which all pkgcloud clients inherit from 
 *
 * (C) 2011 Nodejitsu Inc.
 *
 */

var fs = require('fs'),
    events = require('eventemitter2'),
    morestreams = require('morestreams'),
    request = require('request'),
    utile = require('utile'),
    qs    = require('querystring'),
    common = require('../../common');

var Client = exports.Client = function (options) {
  events.EventEmitter2.call(this, { delimiter: '::', wildcard: true });
  this.config = options || {};
};

utile.inherits(Client, events.EventEmitter2);

Client.prototype.request = function () {
  var self = this,
      responded,
      callback,
      errback,
      options,
      buffer,
      method,
      piped,
      ended, 
      dest;

  if (arguments.length === 3) {
    errback = arguments[1];
    callback = arguments[2];
    options = typeof arguments[0] === 'object' ? arguments[0] : {
      method: 'GET',
      path: arguments[0],
      headers: {}
    };
  }
  else if (arguments.length === 4) {
    errback = arguments[2];
    callback = arguments[3];
    options = {
      method: arguments[0],
      path: arguments[1],
      headers: {}
    };
  }
  else if (arguments.length === 5) {
    var encoded = qs.encode(arguments[2]);
    errback = arguments[3];
    callback = arguments[4];
    options = {
      method: arguments[0],
      path: arguments[1] + (encoded ? '?' + encoded : ''),
      headers: {}
    };
  }

  function sendRequest () {
    //
    // Setup any specific request options before 
    // making the request
    //
    if (self.before) {
      self.before.forEach(function (fn) {
        options = fn.call(self, options) || options;
      });
    }

    //
    // Set the url for the request based
    // on the `path` supplied.
    //
    if (typeof options.path === 'string') {
      options.path = [options.path];
    }
    
    options.uri = self.url.apply(self, options.path);

    var response = request(options, function (err, res, body) {

      if (err) {
        return errback(err);
      }

      var statusCode = res.statusCode.toString(),
          err2;

      if (Object.keys(self.failCodes).indexOf(statusCode) !== -1) {
        //
        // TODO: Support more than JSON errors here
        //
        err2 = new Error(
          self.provider +
          ' Error (' + statusCode + '): ' +
          self.failCodes[statusCode]
        );
        err2.result = JSON.parse(body);
        return errback(err2);
      }

      callback(body, res);
    });
    return response;
  }
  
  //
  // Helper function which sets the appropriate headers
  // for Rackspace Cloudfiles depending on the state of the 
  // buffer.
  //
  // TODO: Refactor this into the Rackspace Cloudfiles client.
  //
  function onPiped() {
    options.headers = options.headers || {};
    
    if (ended) {
      options.headers['content-length'] = buffer.size;
    }
    else {
      options.headers['transfer-encoding'] = 'chunked';
    }
  }
  
  //
  // Helper function which creates a `BufferedStream` to hold
  // any piped data while this instance is authenticating.
  //
  function createBuffer() {
    buffer = new morestreams.BufferedStream();

    buffer.emit = function (event) {
      if (event === 'end' && !responded) {
        ended = true;
        return;
      }
      
      morestreams.BufferedStream.prototype.emit.apply(buffer, arguments);
    };
    
    buffer.pipe = function (target) {
      dest = target;
      morestreams.BufferedStream.prototype.pipe.apply(buffer, arguments);
    };

    buffer.on('pipe', function () {
      piped = true;
    });
  }
  
  function pipeUpload(response) {
    if (piped) {
      buffer.pipe(response);
    }
    else {
      buffer.on('pipe', function () {
        buffer.pipe(response);
      });
    }
  }
  
  function pipeDownload(response) {
    if (piped) {
      response.pipe(dest);
    }
    else {
      //
      // Remark: Do we need to do something here?
      //
    }
  }
  
  
  if (!this.authorized && this.provider === 'rackspace') {
    //
    // If this instance is not yet authorized, then return
    // a `BufferedStream` which can be piped to in the current
    // tick.
    //
    createBuffer();
    this.auth(function (err) {
      onPiped();
      var response = sendRequest();
      
      response.on('end', function () {
        responded = true;
        buffer.emit('end');
        buffer.removeAllListeners('pipe');
      });
            
      if (options.upload) {
        pipeUpload(response);
      }
      else if (options.download) {
        pipeDownload(response);
      }
    });
    
    return buffer;
  } 
  
  return sendRequest();
};