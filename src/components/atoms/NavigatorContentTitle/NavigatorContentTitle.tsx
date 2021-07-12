import React from 'react';
import styled from 'styled-components';
import {Typography} from 'antd';

import { FontColors } from '@styles/Colors';

const {Text} = Typography;

export type NavigatorContentTitleProps =  {};

const NavigatorContentTitle = styled((props: NavigatorContentTitleProps) => <Text {...props}/>)`
  &.ant-typography {
    margin-bottom: 0;
    padding: 8px;
    padding-left: 16px;
    text-transform: uppercase;
    font-size: 17px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
    font-variant: tabular-nums;
    font-style: normal;
    font-weight: 600;
    line-height: 24px;
    color: ${FontColors.darkThemeMainFont};
  }
`;

export default NavigatorContentTitle;