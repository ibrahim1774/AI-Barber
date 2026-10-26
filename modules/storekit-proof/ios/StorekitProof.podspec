Pod::Spec.new do |s|
  s.name           = 'StorekitProof'
  s.version        = '1.0.0'
  s.summary        = 'Returns the current subscription entitlement as an Apple-signed JWS.'
  s.description    = 'Local Expo module for Prime Barber: StoreKit 2 Transaction.currentEntitlements -> jwsRepresentation.'
  s.author         = ''
  s.homepage       = 'https://aibarber.org'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
