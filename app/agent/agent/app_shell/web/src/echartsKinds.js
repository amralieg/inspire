import echarts from './echarts.js';
import { CustomChart, GaugeChart, RadarChart, SankeyChart, TreemapChart } from 'echarts/charts';
import { MarkLineComponent, RadarComponent } from 'echarts/components';

echarts.use([CustomChart, GaugeChart, MarkLineComponent, RadarChart, RadarComponent, SankeyChart, TreemapChart]);

export default echarts;
