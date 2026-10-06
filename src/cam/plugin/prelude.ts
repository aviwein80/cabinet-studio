/**
 * The `cs` object a plugin sees (M2.10, API-01), as JavaScript run inside the sandbox before the
 * plugin's own code. It talks to the app through one function, `__host(name, argsJson)`, which
 * the sandbox removes from the global scope before the plugin runs. Everything crosses as JSON
 * text, so a plugin only ever holds copies, never the app's own objects.
 *
 * Keep in step with the typed reference in `api.ts` (a test checks every name exists).
 */
export const PRELUDE = String.raw`
(function () {
  'use strict'
  var host = globalThis.__host
  delete globalThis.__host
  var call = function (name) {
    var args = Array.prototype.slice.call(arguments, 1)
    var r = host(name, JSON.stringify(args))
    return r === undefined ? undefined : JSON.parse(r)
  }
  var callAsync = function (name) {
    var args = Array.prototype.slice.call(arguments, 1)
    return host(name, JSON.stringify(args)).then(function (r) { return r === undefined ? undefined : JSON.parse(r) })
  }
  var text = function (a) { return Array.prototype.map.call(a, function (x) { return typeof x === 'string' ? x : JSON.stringify(x) }).join(' ') }

  // the same random numbers on every run (results must not change from run to run)
  var seed = 0x2f6b9a1d
  Math.random = function () {
    seed = (seed + 0x6d2b79f5) | 0
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  var handlers = { menu: {}, step: {}, post: {} }
  var found = { menu: [], steps: [], posts: [] }
  var idOk = function (id, what) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error(what + ' id must use letters, digits, "-" and "_".')
  }
  var fn = function (f, what) { if (typeof f !== 'function') throw new Error(what + ' must be a function.') }

  var findIndex = function (list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i
    return -1
  }
  var taken = function (part, id) { return findIndex(part.entities, id) >= 0 || findIndex(part.ops, id) >= 0 }
  var freshId = function (part, id) { return id && !taken(part, id) ? id : call('newId') }
  var merge = function (op, patch) {
    for (var k in patch) {
      var v = patch[k]
      if (v && typeof v === 'object' && !Array.isArray(v) && op[k] && typeof op[k] === 'object' && !Array.isArray(op[k])) op[k] = Object.assign({}, op[k], v)
      else op[k] = v
    }
    return op
  }

  var part = {
    shapes: function (p, layer) {
      if (layer === undefined) return p.entities.slice()
      var l = p.layers.filter(function (x) { return x.id === layer || x.name === layer })[0]
      var id = l ? l.id : layer
      return p.entities.filter(function (e) { return e.layer === id })
    },
    closed: function (e) { return e.g.t === 'circle' || (e.g.t === 'contour' && e.g.c.closed) || (e.g.t === 'spline' && e.g.closed) },
    addShape: function (p, geom, layer, face) {
      var e = call('part.entity', geom, layer || 'outline', face || 1)
      e.id = freshId(p, e.id)
      if (!p.layers.some(function (l) { return l.id === e.layer })) part.layer(p, e.layer)
      p.entities.push(e)
      return e.id
    },
    addEntity: function (p, e) {
      var copy = JSON.parse(JSON.stringify(e))
      copy.id = freshId(p, copy.id)
      p.entities.push(copy)
      return copy.id
    },
    setEntity: function (p, id, patch) {
      var i = findIndex(p.entities, id)
      if (i < 0) throw new Error('No shape ' + id + '.')
      p.entities[i] = Object.assign({}, p.entities[i], patch, { id: id })
    },
    removeEntity: function (p, id) {
      p.entities = p.entities.filter(function (e) { return e.id !== id })
      p.ops.forEach(function (o) { o.geometry = o.geometry.filter(function (g) { return g !== id }) })
    },
    addOp: function (p, kind, geometry, patch) {
      var op = merge(call('ops.default', kind, geometry || []), patch || {})
      op.id = freshId(p, op.id)
      p.ops.push(op)
      return op.id
    },
    addOpObject: function (p, op) {
      var copy = JSON.parse(JSON.stringify(op))
      copy.id = freshId(p, copy.id)
      p.ops.push(copy)
      return copy.id
    },
    setOp: function (p, id, patch) {
      var i = findIndex(p.ops, id)
      if (i < 0) throw new Error('No operation ' + id + '.')
      p.ops[i] = merge(Object.assign({}, p.ops[i]), patch)
      p.ops[i].id = id
    },
    removeOp: function (p, id) { p.ops = p.ops.filter(function (o) { return o.id !== id }) },
    moveOp: function (p, id, index) {
      var i = findIndex(p.ops, id)
      if (i < 0) throw new Error('No operation ' + id + '.')
      var op = p.ops.splice(i, 1)[0]
      p.ops.splice(Math.max(0, Math.min(index, p.ops.length)), 0, op)
    },
    set: function (p, patch) { Object.assign(p, patch) },
    layer: function (p, name, color) {
      var l = p.layers.filter(function (x) { return x.id === name || x.name === name })[0]
      if (l) return l.id
      p.layers.push({ id: name, name: name, color: color || '#9ca3af', visible: true, locked: false })
      return name
    },
  }

  var cs = {
    apiVersion: 1,
    log: function () { call('log', 'info', text(arguments)) },
    warn: function () { call('log', 'warning', text(arguments)) },
    menu: {
      add: function (item, run) {
        idOk(item && item.id, 'Menu item')
        fn(run, 'A menu item\'s action')
        var area = item.area === 'job' ? 'job' : 'part'
        if (typeof item.label !== 'string' || !item.label) throw new Error('A menu item needs a label.')
        handlers.menu[item.id] = run
        found.menu = found.menu.filter(function (m) { return m.id !== item.id })
        found.menu.push({ id: item.id, label: item.label, area: area })
      },
    },
    batch: {
      step: function (def) {
        idOk(def && def.id, 'Batch step')
        if (!def.afterNest && !def.beforeOutput) throw new Error('A batch step needs afterNest or beforeOutput.')
        if (def.afterNest) fn(def.afterNest, 'afterNest')
        if (def.beforeOutput) fn(def.beforeOutput, 'beforeOutput')
        handlers.step[def.id] = def
        found.steps = found.steps.filter(function (s) { return s.id !== def.id })
        found.steps.push({ id: def.id, name: String(def.name || def.id), description: String(def.description || ''), hooks: ['afterNest', 'beforeOutput'].filter(function (h) { return !!def[h] }) })
      },
    },
    post: {
      add: function (def) {
        idOk(def && def.id, 'Post')
        fn(def.run, 'A post\'s run')
        handlers.post[def.id] = def
        found.posts = found.posts.filter(function (s) { return s.id !== def.id })
        found.posts.push({ id: def.id, name: String(def.name || def.id), ext: String(def.ext || 'nc').replace(/^\./, ''), description: String(def.description || '') })
      },
    },
    part: part,
    geom: {
      rect: function (x, y, w, h) { return call('geom.rect', x, y, w, h) },
      roundedRect: function (x, y, w, h, r) { return call('geom.roundedRect', x, y, w, h, r) },
      circle: function (x, y, r) { return call('geom.circle', x, y, r) },
      polyline: function (points, closed) { return call('geom.polyline', points, !!closed) },
      offset: function (contours, d) { return call('geom.offset', contours, d) },
      union: function (a, b) { return call('geom.boolean', 'union', a, b) },
      difference: function (a, b) { return call('geom.boolean', 'difference', a, b) },
      intersection: function (a, b) { return call('geom.boolean', 'intersection', a, b) },
      area: function (c) { return call('geom.area', c) },
      length: function (c) { return call('geom.length', c) },
      box: function (contours) { return call('geom.box', contours) },
      ofShape: function (e) { return call('geom.ofShape', e) },
    },
    ops: {
      kinds: function () { return call('ops.kinds') },
      defaults: function (kind) { return call('ops.default', kind, []) },
    },
    tools: { list: function () { return call('tools.list') } },
    units: {
      current: function () { return call('units.current') },
      format: function (mm) { return call('units.format', mm) },
      parse: function (s) { return call('units.parse', s) },
    },
    files: {
      read: function (path) { return callAsync('files.read', path) },
      write: function (path, data) { return callAsync('files.write', path, String(data)) },
      list: function (folder) { return callAsync('files.list', folder) },
    },
    net: { fetch: function (url, init) { return callAsync('net.fetch', url, init || {}) } },
  }
  var freeze = function (o) {
    Object.freeze(o)
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') freeze(o[k]) })
    return o
  }
  Object.defineProperty(globalThis, 'cs', { value: freeze(cs), writable: false, configurable: false })

  var done = function (v) { return JSON.stringify(v === undefined ? null : v) }
  Object.defineProperty(globalThis, '__cs', {
    value: freeze({
      found: function () { return JSON.stringify(found) },
      run: function (kind, id, hook, json) {
        var ctx = JSON.parse(json)
        if (kind === 'menu') {
          var m = handlers.menu[id]
          if (!m) throw new Error('No menu item ' + id + '.')
          return Promise.resolve(m(ctx)).then(function (r) { return done({ part: ctx.part, job: undefined, result: r === undefined ? null : r }) })
        }
        if (kind === 'step') {
          var s = handlers.step[id]
          if (!s || !s[hook]) throw new Error('No batch step ' + id + ' ' + hook + '.')
          return Promise.resolve(s[hook](ctx)).then(done)
        }
        if (kind === 'post') {
          var p = handlers.post[id]
          if (!p) throw new Error('No post ' + id + '.')
          return Promise.resolve(p.run(ctx)).then(function (r) {
            if (typeof r !== 'string') throw new Error('A post must return the program as text.')
            return done(r)
          })
        }
        throw new Error('Unknown call ' + kind + '.')
      },
    }),
    writable: false,
    configurable: false,
  })
})()
`
