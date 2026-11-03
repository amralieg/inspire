import echarts from './echarts.js';
import { GaugeChart } from 'echarts/charts';
import { MarkLineComponent } from 'echarts/components';

echarts.use([GaugeChart, MarkLineComponent]);

export default echarts;
