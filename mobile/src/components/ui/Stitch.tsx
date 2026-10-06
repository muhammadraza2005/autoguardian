import { ScrollView, View, Pressable, StyleSheet, type ViewProps, type TextProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { colors } from '@/theme/tokens';

export function AppHeader({ subtitle, owner = false }: { subtitle?: string; owner?: boolean }) {
  const { t, i18n } = useTranslation();
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.headerSafe}>
    <View style={s.header}>
      <View style={s.brandRow}><Ionicons name="shield-outline" size={24} color={colors.accent} /><AppText numberOfLines={1} style={s.brand}>AutoGuardian</AppText></View>
      <View style={s.languages}>{['fr', 'en'].map(lang => <Pressable key={lang} accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'English' : 'Français'} accessibilityState={{ selected: i18n.language.startsWith(lang) }} onPress={() => void i18n.changeLanguage(lang)} style={[s.language, i18n.language.startsWith(lang) && s.languageActive]}><AppText style={[s.languageText, i18n.language.startsWith(lang) && s.languageTextActive]}>{lang.toUpperCase()}</AppText></Pressable>)}</View>
    </View>
    {(subtitle || owner) && <View style={s.subheader}>{subtitle && <AppText style={s.subheaderText}>{subtitle}</AppText>}{owner ? <AppText style={s.owner}>{t('stitch.ownerAccount')}</AppText> : <AppText style={s.subheaderMuted}>{t('stitch.platform')}</AppText>}</View>}
  </SafeAreaView>;
}

export function StitchPage({ children, style }: ViewProps) {
  return <ScrollView style={s.page} contentContainerStyle={[s.content, style]} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}
export function Card({ children, style }: ViewProps) { return <View style={[s.card, style]}>{children}</View>; }
export function Copy({ children, style, ...props }: TextProps) { return <AppText {...props} style={[s.copy, style]}>{children}</AppText>; }
export function Heading({ children, style }: TextProps) { return <AppText style={[s.heading, style]}>{children}</AppText>; }
export function Label({ children, style }: TextProps) { return <AppText style={[s.label, style]}>{children}</AppText>; }
export function DetailRow({ label, value }: { label: string; value: string }) { return <View style={s.detail}><Copy style={s.detailLabel}>{label}</Copy><Copy style={s.detailValue}>{value}</Copy></View>; }
export function Action({ label, icon, onPress, secondary = false, danger = false, disabled = false, style }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={({pressed}) => [s.action, secondary && s.actionSecondary, danger && s.actionDanger, {opacity: disabled ? 0.45 : pressed ? 0.8 : 1}, style]}>{icon && <Ionicons name={icon} size={20} color={danger ? colors.danger : secondary ? colors.primary : colors.accent} />}<AppText style={[s.actionText, secondary && {color: colors.primary}, danger && {color: colors.danger}]}>{label}</AppText></Pressable>;
}
export function Notice({ children, icon = 'information-circle-outline', tone = 'neutral' }: { children: React.ReactNode; icon?: keyof typeof Ionicons.glyphMap; tone?: 'neutral' | 'warning' | 'danger' }) {
  const tint = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.textMuted;
  return <View style={[s.notice, tone === 'warning' && s.noticeWarning, tone === 'danger' && s.noticeDanger]}><Ionicons name={icon} size={19} color={tint} /><Copy style={{flex:1, color:tint}}>{children}</Copy></View>;
}
export function Progress({ value, color = colors.accent }: { value: number; color?: string }) { return <View style={s.track}><View style={{width: `${value}%`, height: '100%', backgroundColor: color, borderRadius: 5}} /></View>; }
export const stitchStyles = StyleSheet.create({
  row: {flexDirection:'row', alignItems:'center', gap:8},
  between: {flexDirection:'row', justifyContent:'space-between', alignItems:'center', gap:8},
  input: {minHeight:48, borderWidth:1, borderColor:colors.border, borderRadius:6, paddingHorizontal:12, fontSize:16, color:colors.primary, fontFamily:'PublicSans-Regular', backgroundColor:colors.background},
  muted: {color:colors.textMuted},
  divider: {height:1, backgroundColor:colors.border},
  inset: {backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border, borderRadius:6, padding:12, gap:8},
  badge: {backgroundColor:'#E5EEFF', color:colors.primary, borderWidth:1, borderColor:'#B2C7EE', borderRadius:4, paddingHorizontal:8, paddingVertical:4, fontSize:11, lineHeight:16},
});
const s = StyleSheet.create({
  headerSafe:{backgroundColor:colors.primary,width:'100%',flexShrink:0}, header:{minHeight:64,paddingHorizontal:16,paddingVertical:4,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  brandRow:{flex:1,minWidth:0,flexDirection:'row',alignItems:'center',gap:8}, brand:{flexShrink:1,fontSize:18,lineHeight:24,fontWeight:'700',color:'white',letterSpacing:-0.5},
  languages:{flexShrink:0,flexDirection:'row',borderWidth:1,borderColor:'#405571',borderRadius:5,padding:2}, language:{minHeight:48,minWidth:48,paddingHorizontal:6,alignItems:'center',justifyContent:'center',borderRadius:3}, languageActive:{backgroundColor:colors.accent}, languageText:{color:'#BCC8D8',fontSize:12,lineHeight:18,fontWeight:'600'}, languageTextActive:{color:colors.primary},
  owner:{fontSize:12,lineHeight:18,color:'white',flexShrink:1,backgroundColor:'#203F65',padding:4,borderRadius:3},
  subheader:{backgroundColor:'#001632',paddingHorizontal:16,paddingVertical:7,flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8}, subheaderText:{color:'white',fontSize:12,lineHeight:18,flexShrink:1}, subheaderMuted:{color:'#A3B1C5',fontSize:12,lineHeight:18,flexShrink:1,textAlign:'right'},
  page:{flex:1,backgroundColor:'white'},content:{padding:16,gap:16,paddingBottom:28,flexGrow:1},card:{backgroundColor:'white',borderWidth:1,borderColor:colors.border,borderRadius:8,padding:14,gap:14},
  heading:{fontSize:20,lineHeight:28,fontWeight:'700',color:colors.primary},copy:{fontSize:14,lineHeight:21},label:{fontSize:13,lineHeight:18,fontWeight:'600',color:colors.primary},
  detail:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:7,borderBottomWidth:1,borderBottomColor:colors.border},detailLabel:{color:colors.textMuted,flexShrink:0,fontSize:12},detailValue:{fontWeight:'600',textAlign:'right',flexShrink:1,fontSize:13},
  action:{minHeight:48,paddingHorizontal:12,paddingVertical:12,borderRadius:6,backgroundColor:colors.primary,borderWidth:1,borderColor:colors.primary,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8}, actionSecondary:{backgroundColor:'white',borderColor:colors.border},actionDanger:{backgroundColor:'white',borderColor:colors.danger,borderWidth:2},actionText:{fontSize:14,lineHeight:20,fontWeight:'600',color:'white',textAlign:'center',flexShrink:1},
  notice:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:12,borderWidth:1,borderColor:colors.border,borderRadius:6,backgroundColor:colors.surface},noticeWarning:{borderColor:'#FFDF94',backgroundColor:colors.warningBackground},noticeDanger:{borderColor:'#FFDAD6',backgroundColor:colors.dangerBackground,borderLeftWidth:4},track:{height:8,backgroundColor:colors.border,borderRadius:5,overflow:'hidden'},
});
