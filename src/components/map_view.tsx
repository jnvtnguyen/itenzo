// THE APP-FACING MAP COMPONENT. ON WEB THIS IS THE RASTER TILE MAP; THE
// .native COUNTERPART RENDERS @rnmapbox/maps WHEN THE NATIVE BINARY EXISTS
// (EAS DEV BUILD) AND FALLS BACK TO THE SAME TILE MAP IN EXPO GO. IMPORT
// MapView FROM HERE — NEVER TileMap OR @rnmapbox/maps DIRECTLY.
export { TileMap as MapView, type MapPin, type TileMapProps } from '@/components/tile_map';
