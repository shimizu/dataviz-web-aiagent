# A plugin for raster reprojection in d3

Here is a demo of a simple d3 plugin to reproject (warp) a raster image using d3.

I was motivated to make it because I could not get [gdalwarp](http://www.gdal.org/gdalwarp.html) to produce nice reprojections of rasters when the target projection had the antimeridian inside the picture, e.g. in a rotated orhographic projection (showing Earth's "back side"). The gdalwarp utility typically leaves a thin sliver unpainted close to the antimeridian, which shows up as a transparent line along the antimeridian.

## How to use the plugin

The plugin behind this demo (see below, or in the [GitHub repo](https://github.com/rasmuse/d3-geo-warp/blob/f1a36fd3852e3256b76230b06773f7a6fd6de6e2/src/geoWarp.js)) is only a proof of concept, not ready for production. But it illustrates that we can easily create a pretty neat API for raster reprojection, something like this:

```javascript

var dstCanvas = d3.select('#warped').node();
var srcProj = d3.geoEquirectangular(),
    dstProj = d3.geoOrthographic(),

var world = {type: 'Sphere'},

// Fit the whole world inside the destination canvas
dstProj.fitSize([dstCanvas.width, dstCanvas.height]], world);

var warp = d3.geoWarp()
    .srcProj(srcProj)
    .dstProj(dstProj)
    .dstContext(dstContext);

var srcImg = d3.select('#src').node();

srcImg.onload = function () {
    // The source image is known to contain the whole world.
    // Of course, this can be hard coded if the image size is known.
    srcProj.fitSize([srcImg.width, srcImg.height], world);

    warp(srcImg);
}

srcImg.src = 'path/to/source/dataset.png';
```

## Notes on implementation

The [projection.`fitExtent`](https://github.com/d3/d3-geo#projection_fitExtent) method (new in [`d3-geo` v1.2.0](https://github.com/d3/d3-geo/releases/tag/v1.2.0)) makes it easy to fit a d3 `geoProjection` to an image containing a map. The fitted projection object can then be used to sample the source image at some geographical coordinates without working out the conversion between image pixels and geographical coordinates.

No big assumptions are made about the source and destination projections. I only require that the destination projection is invertible. The source projection and the destination projection's inverse are called for each pixel in the destination raster. This is not fast, but it's simple :) As you can probably see from the poor animation frame rate on this page, the algorithm is not really useful for animated on-the-fly reprojection.

In this example, the source image is in [equirectangular projection](https://en.wikipedia.org/wiki/Equirectangular_projection) which is pretty typical for geographical raster datasets.

So far I only implemented nearest neighbor resampling, but other algorithms should be relatively straightforward to add.
