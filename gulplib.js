/*globals require, console, Buffer, Promise*/
module.exports = function(gulp) {

  var l = {};
  
  var sass, uglify, watch, concat, notify, browserify, browserify_css,
    source, sourcemaps, buffer, watchify, stringify, fs, text_encoding,
    parser, git, exec, babelify;

  l.sass = sass = require('gulp-sass'),
  l.uglify = uglify = require('gulp-uglify'),
  l.watch = watch = require('gulp-watch'),
  l.concat = concat = require('gulp-concat'),
  l.notify = notify = require('gulp-notify'),
  l.replace = replace = require("gulp-replace"),
  l.rename = rename = require("gulp-rename"),
  l.browserify = browserify = require('browserify'),
  l.browserify_css = browserify_css = require('browserify-css'),
  l.source = source = require("vinyl-source-stream"),
  l.sourcemaps = sourcemaps = require('gulp-sourcemaps'),
  l.buffer = buffer = require('vinyl-buffer'),
  l.watchify = watchify = require('watchify'),
  l.stringify = stringify = require('stringify'),
  l.fs = fs = require("fs"),
  l.text_encoding = text_encoding = require("text-encoding"),
  l.parser = parser = require("csv-parse"),
  l.git = git = require("gulp-git"),
  l.babelify = babelify = require("babelify"),
  l.exec = exec = require('child_process').exec;
    //pako = require("pako")*/

  var makeDirectory = l.makeDirectory = function(address, cb) {
    fs.mkdir(address, function(e) {
      if (e!==null) {
        if (e.code!=="EEXIST") {
          throw new Error(e);
        }
      }
      cb();
    });
  }
  
  function swallowError(error) {
      console.log(error.toString());
      this.emit('end');
  }
  
  function copyIndex() {
    gulp.src('./index.*')
      .pipe(l.replace("js/app.js","js/app.min.js"))
      .pipe(gulp.dest("./build/"))
      .pipe(l.replace("js/app.min.js","js/app.js"))
      .pipe(l.rename(function(path) {
        path.basename += "_debug";
      }))
      .pipe(gulp.dest("./build/"));
  }
  
  l.get_cbpp_shared_libs = function(arr, cb) {
    if (typeof(arr)==="string") {
      l.get_cbpp_shared_lib(arr, cb);
    } else {
      var p = [];
      arr.forEach(function(name) {
        p.push(new Promise(function(resolve, reject) {
          try {
            l.get_cbpp_shared_lib(name, resolve);
          } catch (ex) {
            console.log(ex);
            reject(ex);
          }
        }));
      });
      Promise.all(p).then(function() {
        if (typeof(cb)==="function") {
          cb();
        }
      });
    }
  };
  
  l.get_cbpp_shared_lib = function(name, cb) {
    if (!fs.existsSync("./" + name)) {
      git.clone("https://github.com/CenterOnBudget/" + name, {args: "--depth=1"}, function(err) {
        if (err) {
          throw err;
        }
        exec('npm install', {cwd: process.cwd() + "/" + name}, function(err) {
          if (err) {
            console.log(err);
          }
          if (typeof(cb)==="function") {cb();}
        });
      });
    } else {
      if (typeof(cb)==="function") {cb();}
    }
  };

  l.scss_additional_target_list = [];
  
  gulp.task("cbpp_shared_lib", function(cb) {
    console.log("No shared CBPP libraries specified in gulpfile");
    cb();
  });
  
  // sass task
  gulp.task('sass', gulp.series('cbpp_shared_lib', function (cb) {
    var handleStream = function(src) {
      return new Promise(function(resolve, reject){
        gulp.src(src, {base:"./"})
        .pipe(sass())
        .on('error', swallowError)
        .pipe(gulp.dest('.'))
        .on("end", resolve);
      });
    };
    var list = [
      handleStream(['./**/*.scss', '!./node_modules/**/*.scss']),
      handleStream(['./node_modules/cbpp*/**/*.scss'])
    ];
    
    for (var i = 0, ii = l.scss_additional_target_list.length; i<ii; i++) {
      list.push(
        handleStream(l.scss_additional_target_list[i])
      );
    }
    Promise.all(list).then(function() {
      if (typeof(cb)==="function") {
        cb();
      }
    });
  }));
  
  function doBrowserify(entries) {
    copyIndex();
    var b = browserify({
        entries: entries,
        debug: true,
        cache: {},
        packageCache: {}
    });
    b.transform(browserify_css, {global:true});
    //b.transform(l.babelify, {presets:["env"]});
    b.transform(stringify, {
        appliesTo: {includeExtensions: ['.txt','.csv','.html']}
    });
    b.doBundle = function() {
      var r = this.bundle()
        .on('error', swallowError)
        .pipe(source('app.js'))
        .pipe(buffer());
  
      r.doUglify = function() {
        this.pipe(sourcemaps.init({loadMaps: true}))
          // Add transformation tasks to the pipeline here.
          .pipe(uglify())
          .pipe(sourcemaps.write('./'));
        return this;
      };
  
      r.writeBundle = function(cb) {
        this.pipe(gulp.dest('./build/js')).on("end", function() {
          console.log("built");
          if (typeof(cb)==="function") {
            cb();
          }
        });
        return this;
      };
      return r;
    };
    return b;
  }
  
  
  
  gulp.task('buildDirectory', function(cb) {
    makeDirectory("./build", cb);
  });
  
  gulp.task('intermediate', function(cb) {
    makeDirectory("./intermediate",cb);
  });
  
  gulp.task("copyIndex", function(cb) {
    copyIndex();
    cb();
  });
  
  gulp.task("server", function(cb) {
    var http = require('http');
    var fs = require("fs");
    var exec = require("child_process").exec;
    var serverPort = 8000;
    if (typeof(l.serverPort)!=="undefined") {
      serverPort = l.serverPort;
    }
    var server = http.createServer(function(req, res) {
      function parse_php_res(f) {
        var offset;
        for (var i = 0, ii = f.length; i<ii; i++) {
          //utf8 double line break
          if (f[i]===13 && f[i+1]===10 && f[i+2]==13 && f[i+3]===10) {
            offset = i;
          }
        }
        var headers = [];
        for (i = 0; i<offset;i++) {
          headers.push(f[i]);
        }
        var body = [];
        for (i = offset+4, ii = f.length; i<ii; i++) {
          body.push(f[i]);
        }
        headers = Buffer.from(headers).toString("utf8").split("\r\n");
        body = Buffer.from(body);
        var headersObj = {};
        headers.forEach(function(header) {
          header = header.split(":");
          headersObj[header[0]] = header[1];
        });
        var result = {};
        result.headers = headersObj;
        result.body = body;
        return result;
      }
      
      try {
        var headers = {
          'max-age':86400,
          'Access-Control-Allow-Origin':"*",
          'Vary':"Access-Control-Allow-Origin",
          'Access-Control-Allow-Headers':'referrer, range, accept-encoding, x-requested-with',
          'Access-Control-Allow-Methods':'POST, GET, OPTIONS'
        };
        var file = req.url.split("?")[0];
        var ext = file.split(".")[file.split(".").length-1];
        
        if (ext==="php") {
          var command = "php-cgi \"" + __dirname + "/build" + file + "\" " + req.url.split("?")[1].split("&").join(" ");
          exec(command, {encoding:"Buffer"}, function(err, f) {
            var parsed = parse_php_res(f);
            res.writeHead(200, parsed.headers);
            res.write(parsed.body);
            res.end();
          });
        } else {
          if (ext==="svg") {
            res.setHeader("Content-Type","image/svg+xml");
          }
          fs.readFile("./build" + file, function (err, file) {
            if (err) {
              res.end('HTTP/1.1 400 Bad Request\r\n\r\n');
              return;
            }
            if (ext === "json") {
              headers['Content-Type'] = 'application/json';
            }
            res.writeHead(200, headers);
            res.write(file);
            res.end();
          });
        }
      } catch (ex) {
        res.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });
    server.on('clientError', function (err, socket) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
    server.listen(serverPort);
    cb(); 
  });

  gulp.task('data', gulp.series('intermediate', function(taskDone) {
    l.dataHandler(function(allJSON) {
      l.fs.writeFile("./intermediate/data.json", JSON.stringify({data:allJSON}), taskDone);
    });
  }));
  
  l.watch_list = [
    [['./**/*.scss'],{usePolling: true},gulp.series('sass')],
    [['./**/*.csv'],{usePolling: true},gulp.series('data')],
    [['./index.*'],{usePolling: true},gulp.series('copyIndex')]
  ];

  gulp.task('preBuild', function(cb) {
    cb();
  });
  
  gulp.task('build-watch', gulp.series(gulp.parallel('sass', 'buildDirectory', 'server', 'preBuild'), function() {
    l.watch_list.forEach(function(d) {
      gulp.watch(d[0], d[1], d[2]);
    });
    var b = doBrowserify("./app.js");
    b.plugin(watchify, {
      poll: true
    });
    b.on('update', function() {
      console.log("file change detected");
      b.doBundle().writeBundle();
    });
    return b
      .doBundle()
      .writeBundle();
  }));

  var babelProcess, minProcess;
  function babelOutput(cb) {
    if (babelProcess) {
      babelProcess.kill();
    }
    babelProcess = exec("npx babel ./build/js/app.js -o ./build/js/app.babeled.js --source-maps", function(err, out) {
      if (err) {console.log(err);}
      if (out) {console.log(out);}
      babelProcess = null;
      cb();
    });
  }
  
  function minOutput(cb) {
    minProcess = exec("npx uglifyjs --compress --mangle -o ./build/js/app.min.js -- ./build/js/app.babeled.js", function(err, out) {
      if (err) {console.log(err);}
      if (out) {console.log(out);}
      cb();
    });
  }
  
  
  
  gulp.task('minify', function(cb) {
    babelOutput(function() {
      console.log("babeled");
      minOutput(function() {
        console.log("minified");
        cb();
      });
    });
  });
  
  l.dataEncoding = "windows-1252";
  l.percentRounding = 2;
  l.dataHandler = function(f_cb) {
    var allJSON = {};
    var fileRead = function(err, data, file, cb) {
      data = Buffer.from(data,'hex');
      data = new text_encoding.TextDecoder(l.dataEncoding).decode(data);
      parser(data, function(err, data) {
        fileParse(err, data, file, cb);
      });
    };
    var m = Math.pow(10, l.percentRounding-2);
    var fileParse = function(err, data, file, cb) {
      data.forEach(function(row) {
        row.forEach(function(cell, col) {
          if (cell==="") {return;}
          var n;
          if (cell.charAt(cell.length-1)==="%") {
            n = Math.round(cell.replace(/[,%]/g,"")*m)/(m*100);
          } else {
            n = cell.replace(/Ð/g,"-");
            n = n.replace(/[,$\s]/g,"")*1;
          }
          if (!isNaN(n)) {
            row[col] = n;
          }
        });
      });
      allJSON[file] = data;
      cb();
    };
    var promiseMaker = function(file) {
      return new Promise(function(resolve, reject) {
        var fileArr = file.split(".");
        var extension = fileArr[fileArr.length-1];
        fileArr.splice(-1);
        var base = fileArr.join(".");
        if (extension==="csv") {
          fs.readFile("./csv/" + file, function(err, data) {
            fileRead(err, data, base, function() {
              resolve(base);
            });
          });
        } else {
          resolve(base);
        }
      });
    };
    if (fs.existsSync("./csv")) {
      fs.readdir("./csv", function(err, files) {
        var promises = [];
        files.forEach(function(file) {
          promises.push(promiseMaker(file));
        });
        Promise.all(promises).then(function() {
          f_cb(allJSON);
        });
      });
    }
  };
  
  
  
 
  
  gulp.task('default', gulp.series('build-watch'));
  
  l.gulp = gulp;

  return l;
  
};
  