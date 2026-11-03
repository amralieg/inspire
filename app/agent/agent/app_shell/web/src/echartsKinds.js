import echarts from './echarts.js';
import { GaugeChart, RadarChart, SankeyChart, TreemapChart } from 'echarts/charts';
import { MarkLineComponent, RadarComponent } from 'echarts/components';

echarts.use([GaugeChart, MarkLineComponent, RadarChart, RadarComponent, SankeyChart, TreemapChart]);

export default echarts;
