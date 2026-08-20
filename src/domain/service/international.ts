export type InternationalTariffGroup = 1 | 2 | 3 | 4

export interface InternationalDestination {
  code: string
  label: string
  tariffGroup: InternationalTariffGroup
}

const ISO_REGION_CODES = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ
BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CO CR CU
CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA
GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HN HR HT HU ID IE IL
IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC
LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MP MQ MR MS MT MU
MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL
PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM
SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TZ UA
UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW
`.trim().split(/\s+/)

const EXCLUDED_PUBLIC_ROUTE_CODES = new Set(['CN', 'HK', 'MO', 'TW'])
const GROUP_ONE_CODES = new Set([
  'JP', 'KG', 'KP', 'KR', 'KZ', 'MN', 'TJ', 'TM', 'UZ', 'VN',
])
const GROUP_TWO_CODES = new Set([
  'AE', 'AF', 'AM', 'AZ', 'BD', 'BH', 'BN', 'BT', 'CY', 'GE', 'ID', 'IL',
  'IN', 'IO', 'IQ', 'IR', 'JO', 'KH', 'KW', 'LA', 'LB', 'LK', 'MM', 'MV',
  'MY', 'NP', 'OM', 'PH', 'PK', 'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TL',
  'TR', 'YE',
])
const GROUP_THREE_CODES = new Set([
  'AD', 'AL', 'AT', 'AU', 'AX', 'BA', 'BE', 'BG', 'BY', 'CA', 'CH', 'CZ',
  'DE', 'DK', 'EE', 'ES', 'FI', 'FO', 'FR', 'GB', 'GG', 'GI', 'GR', 'HR',
  'HU', 'IE', 'IM', 'IS', 'IT', 'JE', 'LI', 'LT', 'LU', 'LV', 'MC', 'MD',
  'ME', 'MK', 'MT', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE',
  'SI', 'SJ', 'SK', 'SM', 'UA', 'US', 'VA', 'XK',
])

const PUBLIC_GROUP_NAMES: Record<InternationalTariffGroup, string> = {
  1: '晨星',
  2: '云帆',
  3: '远洋',
  4: '极光',
}

/**
 * 把公开标准代码映射为不对应实际地名的稳定展示别名。
 * 代码本身仍用于校验与计费分组，展示层不得反向生成实际地域名称。
 */
function publicDestinationAlias(
  code: string,
  tariffGroup: InternationalTariffGroup,
): string {
  const [first = 'A', second = 'A'] = code
  const ordinal =
    (first.charCodeAt(0) - 'A'.charCodeAt(0)) * 26 +
    (second.charCodeAt(0) - 'A'.charCodeAt(0)) +
    1
  return `${PUBLIC_GROUP_NAMES[tariffGroup]}演练区-${String(ordinal).padStart(3, '0')}`
}

export function internationalTariffGroup(
  countryCode: string,
): InternationalTariffGroup {
  const code = countryCode.trim().toUpperCase()
  if (GROUP_ONE_CODES.has(code)) return 1
  if (GROUP_TWO_CODES.has(code)) return 2
  if (GROUP_THREE_CODES.has(code)) return 3
  return 4
}

export const INTERNATIONAL_DESTINATIONS: InternationalDestination[] =
  ISO_REGION_CODES
    .filter((code) => !EXCLUDED_PUBLIC_ROUTE_CODES.has(code))
    .map((code) => {
      const tariffGroup = internationalTariffGroup(code)
      return {
        code,
        label: publicDestinationAlias(code, tariffGroup),
        tariffGroup,
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))

export function internationalDestinationLabel(countryCode: string): string {
  return INTERNATIONAL_DESTINATIONS.find(
    (destination) => destination.code === countryCode.trim().toUpperCase(),
  )?.label ?? countryCode.trim().toUpperCase()
}

export function s10CheckDigit(serial: string): number | null {
  if (!/^\d{8}$/.test(serial)) return null
  const weights = [8, 6, 4, 2, 3, 5, 9, 7]
  const sum = serial.split('').reduce(
    (total, digit, index) => total + Number(digit) * weights[index]!,
    0,
  )
  const result = 11 - (sum % 11)
  if (result === 10) return 0
  if (result === 11) return 5
  return result
}

export function isValidRegisteredS10(value: string): boolean {
  return isValidS10(value, 'registered')
}

export function isValidS10(
  value: string,
  category: 'registered' | 'parcel' | 'express' | 'any' = 'any',
): boolean {
  const code = value.trim().toUpperCase()
  const match = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/.exec(code)
  if (!match) return false
  const requiredPrefix = {
    registered: 'R',
    parcel: 'C',
    express: 'E',
    any: '',
  }[category]
  if (requiredPrefix && !match[1]!.startsWith(requiredPrefix)) return false
  return s10CheckDigit(match[2]!) === Number(match[3])
}
