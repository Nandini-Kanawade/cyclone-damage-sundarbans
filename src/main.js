// 1. Define AOI
var sundarbans = ee.Geometry.Polygon([
  [
    [88.0, 21.5],
    [89.0, 21.5],
    [89.9, 21.8],
    [89.9, 22.5],
    [89.2, 22.5],
    [88.0, 21.9],
    [88.0, 21.5]
  ]
]);

// 2. Calculate the area in square meters
var areaSqMeters = sundarbans.area();
// 3. Convert to square kilometers
var areaSqKm = areaSqMeters.divide(1e6);
// 4. Print the area
print('Area of Sundarbans polygon (sq. km):', areaSqKm);

Map.centerObject(sundarbans, 9);
Map.addLayer(sundarbans, {color: 'blue'}, 'Sundarbans AOI');

// 2. Cyclone metadata
var cycloneInfo = {
  'Fani':   { pre_start: '2019-04-05', pre_end: '2019-04-30', post_start: '2019-05-05', post_end: '2019-05-30' },
  'Amphan': { pre_start: '2020-04-20', pre_end: '2020-05-15', post_start: '2020-05-25', post_end: '2020-06-20' },
  'Bulbul': { pre_start: '2019-10-10', pre_end: '2019-11-03', post_start: '2019-11-11', post_end: '2019-12-05' },
  'Yaas':   { pre_start: '2021-04-25', pre_end: '2021-05-20', post_start: '2021-05-30', post_end: '2021-06-25' },
  'Sitrang': { pre_start: '2022-10-15', pre_end: '2022-10-20', post_start: '2022-10-25', post_end: '2022-11-10' }
};

// 3. Cloud masking function for Sentinel-2
function maskS2(image) {
  var qa = image.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0).and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask).divide(10000);
}

// Labels for displaying area values
var severeLabel = ui.Label('', {color: 'red', fontWeight: 'bold'});
var moderateLabel = ui.Label('', {color: 'orange', fontWeight: 'bold'});

// 4. UI for cyclone selection
var cycloneSelect = ui.Select({
  items: Object.keys(cycloneInfo),
  placeholder: 'Select a Cyclone',
  onChange: function(cyclone) {
    var dates = cycloneInfo[cyclone];
    Map.layers().reset();
    Map.addLayer(sundarbans, {color: 'blue'}, 'Sundarbans AOI');

    var collection = ee.ImageCollection('COPERNICUS/S2_SR');
    var pre = collection
      .filterDate(dates.pre_start, dates.pre_end)
      .filterBounds(sundarbans)
      .map(maskS2)
      .median()
      .clip(sundarbans);

    var post = collection
      .filterDate(dates.post_start, dates.post_end)
      .filterBounds(sundarbans)
      .map(maskS2)
      .median()
      .clip(sundarbans);

    // 5. Index calculations
    var ndvi_pre = pre.normalizedDifference(['B8', 'B4']).rename('NDVI_pre');
    var ndvi_post = post.normalizedDifference(['B8', 'B4']).rename('NDVI_post');
    var d_ndvi = ndvi_post.subtract(ndvi_pre).rename('ΔNDVI');

    var ndmi_pre = pre.normalizedDifference(['B8', 'B11']).rename('NDMI_pre');
    var ndmi_post = post.normalizedDifference(['B8', 'B11']).rename('NDMI_post');
    var d_ndmi = ndmi_post.subtract(ndmi_pre).rename('ΔNDMI');

    var nbr_pre = pre.normalizedDifference(['B8', 'B12']).rename('NBR_pre');
    var nbr_post = post.normalizedDifference(['B8', 'B12']).rename('NBR_post');
    var d_nbr = nbr_post.subtract(nbr_pre).rename('ΔNBR');

    // 6. Damage classification
    var severe_damage = d_ndvi.lt(-0.2)
      .and(d_ndmi.lt(-0.1))
      .and(d_nbr.lt(-0.1))
      .rename('Severe')
      .selfMask();

    var moderate_damage = d_ndvi.lt(-0.15)
      .and(d_ndvi.gte(-0.2))
      .and(d_ndmi.lt(-0.05))
      .and(d_ndmi.gte(-0.1))
      .and(d_nbr.lt(-0.05))
      .and(d_nbr.gte(-0.1))
      .rename('Moderate')
      .selfMask();

    // 7. Add layers to the map
    Map.addLayer(d_ndvi, {min: -0.5, max: 0.5, palette: ['red', 'white', 'green']}, 'ΔNDVI - ' + cyclone);
    Map.addLayer(d_ndmi, {min: -0.5, max: 0.5, palette: ['purple', 'white', 'blue']}, 'ΔNDMI - ' + cyclone);
    Map.addLayer(d_nbr,  {min: -0.5, max: 0.5, palette: ['orange', 'white', 'green']}, 'ΔNBR - ' + cyclone);

    Map.addLayer(severe_damage, {palette: ['black']}, 'Severe Damage');
    Map.addLayer(moderate_damage, {palette: ['yellow']}, 'Moderate Damage');

    // 8. Calculate damage area
    var pixelArea = ee.Image.pixelArea();
    var severeAreaImage = pixelArea.updateMask(severe_damage);
    var moderateAreaImage = pixelArea.updateMask(moderate_damage);

    var severeArea = severeAreaImage.reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: sundarbans,
      scale: 10,
      maxPixels: 1e9
    }).get('area');

    var moderateArea = moderateAreaImage.reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: sundarbans,
      scale: 10,
      maxPixels: 1e9
    }).get('area');

    // Update labels in panel
    severeArea.evaluate(function(areaSqM) {
      var areaKm2 = areaSqM ? (areaSqM / 1e6).toFixed(2) : '0.00';
      severeLabel.setValue('Severe Damage Area: ' + areaKm2 + ' km²');
    });

    moderateArea.evaluate(function(areaSqM) {
      var areaKm2 = areaSqM ? (areaSqM / 1e6).toFixed(2) : '0.00';
      moderateLabel.setValue('Moderate Damage Area: ' + areaKm2 + ' km²');
    });
  }
});

// 9. UI panel
var panel = ui.Panel({
  widgets: [
    ui.Label('Cyclone Damage Visualizer (Sundarbans)', {fontWeight: 'bold', fontSize: '16px'}),
    cycloneSelect,
    ui.Label(''),
    severeLabel,
    moderateLabel
  ],
  style: {width: '300px'}
});
ui.root.insert(0, panel);
