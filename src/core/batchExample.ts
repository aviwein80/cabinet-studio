/** Part lists shipped with the app: the downloadable example and the wizard's check list (M2.9). */

/** "Example list" on the Batch page: parts, a drawing, a door, an assembly with a fitting. */
export const BATCH_EXAMPLE = [
  'order,customer,assembly,item,name,type,file,style,material,length,width,qty,grain,priority,kit,hinge,pull,hardware,panel,face,edge,at',
  'K2041,Weinreb,,1,Pantry shelf,part,,,MDF18,762,304.8,4,no,,,,,,,,,',
  'K2041,Weinreb,,2,Sign blank,drawing,sign.dxf,,MDF18,,,1,,5,,,,,,,,',
  'K2041,Weinreb,,3,Pantry door,door,,Shaker,MDF18,1219.2,457.2,2,yes,,Pantry,left,128,,,,,',
  'K2041,Weinreb,Base B1,4,Left side,part,,,PB18-WHT,720,560,1,,,,,,,,,,',
  'K2041,Weinreb,Base B1,,Hinge plate,fitting,,,,,,1,,,,,,SALICE-B2VGV-H3,4,top,front,100',
].join('\r\n')

/**
 * The list a new batch setup is checked with (setup wizard, last step): plain parts, a door and an
 * assembly with a drilled fitting, all from the built-in library, so it runs without drawings.
 */
export const BATCH_CHECK_LIST = [
  'order,assembly,item,name,type,style,material,length,width,qty,hinge,pull,hardware,panel,face,edge,at',
  'CHECK,,1,Shelf,part,,MDF18,600,300,4,,,,,,,',
  'CHECK,,2,Door,door,Shaker,MDF18,716,446,1,left,128,,,,,',
  'CHECK,Base B1,3,Side,part,,PB18-WHT,720,560,2,,,,,,,',
  'CHECK,Base B1,,Plate,fitting,,,,,1,,,SALICE-B2VGV-H3,3,top,front,100',
].join('\r\n')
