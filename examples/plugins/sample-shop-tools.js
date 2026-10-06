// @plugin sample-shop-tools
// @name Sample shop tools
// @version 1.0
// @description An example plugin: a designer command that pockets the shapes on the POCKET layer, a job command that lists the parts, a batch step that checks sheet use and writes a parts summary, and a command that reads the shop's price list (it asks for C:/Shop/Lists; nothing is read until the owner grants that folder).
// @author Cabinet Studio
// @read C:/Shop/Lists

// Part designer → Plugins: one pocket operation for every closed shape on the POCKET layer.
// The operation gets the app's default values, which keep their Configure badges.
cs.menu.add({ id: 'pocket-layer', label: 'Pocket the closed shapes on layer POCKET', area: 'part' }, function (ctx) {
  var shapes = cs.part.shapes(ctx.part, 'POCKET').filter(cs.part.closed)
  if (!shapes.length) return { message: 'No closed shapes on layer POCKET.' }
  cs.part.addOp(ctx.part, 'pocket', shapes.map(function (s) { return s.id }), { name: 'Pocket (layer POCKET)' })
  return { message: 'Added a pocket for ' + shapes.length + ' shape' + (shapes.length === 1 ? '' : 's') + '. Check its depth and tool.' }
})

// Job page → Plugins: the parts as a text list to save.
cs.menu.add({ id: 'part-list', label: 'Parts list as text', area: 'job' }, function (ctx) {
  var lines = [ctx.job.number + ' ' + ctx.job.name, '']
  ctx.parts.forEach(function (p) {
    lines.push(p.qty + ' x ' + p.name + '  ' + cs.units.format(p.length) + ' x ' + cs.units.format(p.width) + ' x ' + cs.units.format(p.thickness) + '  ' + p.material)
  })
  return { message: ctx.parts.length + ' parts listed.', file: { name: ctx.job.number + '_parts.txt', data: lines.join('\r\n') + '\r\n' } }
})

// Part designer → Plugins: reads a file, so it only works once the owner grants C:/Shop/Lists.
cs.menu.add({ id: 'price-list', label: 'Count the lines of the price list', area: 'part' }, async function () {
  var text = await cs.files.read('C:/Shop/Lists/prices.csv')
  return { message: 'The price list has ' + text.split(/\r?\n/).filter(Boolean).length + ' lines.' }
})

// Batch runs: a step the batch setup can switch on.
cs.batch.step({
  id: 'sheet-use',
  name: 'Sheet use check',
  description: 'Warns about sheets less than 30 % used, and writes a parts summary CSV with each order.',
  afterNest: function (ctx) {
    return {
      messages: ctx.sheets
        .filter(function (s) { return s.utilization < 30 })
        .map(function (s) { return { severity: 'warning', text: 'sheet ' + s.index + ' (' + s.material + ') is only ' + Math.round(s.utilization) + ' % used.' } }),
    }
  },
  beforeOutput: function (ctx) {
    var rows = ['No,Part ID,Part,Material,Length,Width,Thickness']
    ctx.parts.forEach(function (p) {
      rows.push([p.no, p.partId, '"' + p.name.replace(/"/g, '""') + '"', p.material, p.length, p.width, p.thickness].join(','))
    })
    return { files: [{ name: ctx.order.number + '_parts-summary.csv', data: rows.join('\r\n') + '\r\n' }] }
  },
})
