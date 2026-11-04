import echarts from './echarts.js';
import { MapChart } from 'echarts/charts';
import { GeoComponent } from 'echarts/components';
import world from './maps/world.json';
import { WORLD, setShapes } from './kindCharts.js';

echarts.use([MapChart, GeoComponent]);
echarts.registerMap(WORLD, world);
setShapes(world.features);

export default echarts;
