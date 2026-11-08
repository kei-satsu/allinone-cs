import {
  SymbolView as ExpoSymbolView,
  type AndroidSymbol,
  type SFSymbol,
  type SymbolViewProps,
} from 'expo-symbols';

const androidSymbols: Partial<Record<SFSymbol, AndroidSymbol>> = {
  'airplane.arrival': 'flight_land',
  'arrow.clockwise': 'refresh',
  'arrow.right': 'arrow_forward',
  'arrow.trianglehead.2.clockwise.rotate.90': 'sync',
  'arrow.up.right': 'north_east',
  'arrow.uturn.backward': 'undo',
  'barcode.viewfinder': 'barcode',
  calendar: 'calendar_month',
  'camera.fill': 'photo_camera',
  'camera.rotate': 'flip_camera_android',
  checkmark: 'check',
  'checkmark.circle.fill': 'check_circle',
  'chevron.down': 'keyboard_arrow_down',
  'chevron.left': 'chevron_left',
  'chevron.right': 'chevron_right',
  'chevron.up': 'keyboard_arrow_up',
  desktopcomputer: 'computer',
  'doc.text': 'description',
  'doc.text.magnifyingglass': 'manage_search',
  eye: 'visibility',
  ellipsis: 'more_horiz',
  'house.fill': 'home_filled',
  'laptopcomputer': 'laptop',
  magnifyingglass: 'search',
  pause: 'pause',
  'pause.fill': 'pause',
  person: 'person',
  'person.2.fill': 'groups',
  'person.crop.circle': 'account_circle',
  'person.fill': 'person',
  'person.fill.checkmark': 'how_to_reg',
  plus: 'add',
  printer: 'print',
  'printer.fill': 'print',
  'qrcode.viewfinder': 'qr_code_scanner',
  'rectangle.portrait.and.arrow.right': 'logout',
  safari: 'explore',
  'shippingbox': 'package_2',
  'shippingbox.fill': 'inventory_2',
  'square.and.pencil': 'edit',
  'square.and.arrow.up': 'share',
  'square.grid.2x2': 'grid_view',
  'tray.full': 'inventory',
  'tray.full.fill': 'inventory_2',
  trash: 'delete',
  'wifi.slash': 'wifi_off',
  'xmark': 'close',
  'xmark.circle.fill': 'cancel',
};

export function SymbolView(props: SymbolViewProps) {
  if (typeof props.name !== 'string') {
    return <ExpoSymbolView {...props} />;
  }

  const androidName = androidSymbols[props.name as SFSymbol];
  if (!androidName) {
    return <ExpoSymbolView {...props} />;
  }

  return (
    <ExpoSymbolView
      {...props}
      name={{
        ios: props.name as SFSymbol,
        android: androidName,
        web: androidName,
      }}
    />
  );
}
