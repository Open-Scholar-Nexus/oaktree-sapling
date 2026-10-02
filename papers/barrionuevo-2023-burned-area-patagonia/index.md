---
title: Latitudinal assessment of burned area in the Argentinian Andean-Patagonian Forest during 2001-2019 fire seasons
abstract: |
    The Argentinian Andean-Patagonian Forest (AAPF) is a highly biodiverse temperate forest in South America. This area is being threatened by the intensification of climatic conditions that favor the occurrence of fires. However, assessing AAPF burned areas is challenging due to a high climatological and geographic variability. Previous analyses were focused on smaller regions. In this study, a latitudinal (north to south) characterization of the burned area distribution in the AAPF region is proposed. Satellite-derived burned area data was analyzed for the 2001-2019 fire seasons. Two key areas impacted by fires were identified, highlighting the northern AAPF as the most affected region. This study also revealed the intricate relationship between fires and climatic and geographic variability. The results of this assessment can serve as a basis for future research on climate change impacts and fire risk prediction in AAPF, emphasizing the need for informed conservation strategies in this ecologically important region.
---

# Seminar presentation
```{iframe} https://www.youtube.com/embed/XmeMZ7xJxeI
:width: 100%

This article was presented as part of a series of seminars chaired by scientists from Climatematch Academy’s collaborating organizations, CMIP (Couple Model Intercomparison Project) and LEAP (Learning the Earth with Artificial Intelligence and Physics).
```

# Contextualization

The Argentinian Andean-Patagonian Forest (AAPF) is a highly biodiverse temperate forest, which provides numerous ecosystem services and is home to endemic flora (e.g. Nothofagus, Misondendraceas, and Fitzroya) and fauna @amorosoRegionPatagonicaBosques2021. It borders the Chilean Andes to the west and the Patagonian Desert to the east. Conservation of such an important region led to the creation of national parks such as the "Nahuel Huapi National Park" and the "Los Glaciares National Park" in Argentina. The AAPF is also known for being continuously disturbed by fires that determine its floristic structure and composition @matteucciBreveDescripcionRegiones2021.

Several authors have observed a tendency towards the intensification of climatic conditions that can lead to extreme droughts, which favor the occurrence of fires in the temperate forests of the southern hemisphere. Conditions such as extreme temperature and precipitation anomalies are associated with climate variability modes such as El Niño Southern Oscillation (ENSO) and the Southern Annular Mode (SAM). The AAPF region, like the rest of the temperate forests, is at risk if extreme climate conditions persist [](doi:10.1111/j.1442-9993.2010.02236.x).

The objective of this study is to evaluate the burned area in past fire events in the AAPF region during the 2001-2019 fire seasons using satellite-derived data. The AAPF is characterized by a high climatological and geographic variability @matteucciBreveDescripcionRegiones2021. Assessing fire events in this region is challenging due to its long latitudinal extent. While there have been various studies of fire events in recent decades for this area, these were focused on specific subregions and did not consider a higher level view of the fire distribution and frequency. Additionally, averaging the whole AAPF region can yield biased results. That said, it was noticed the necessity of an assessment of the past fires events consequences, in terms of burned area, considering its latitudinal (north to south) occurrence.

# Study area

The AAPF constitutes a long and thin strip located in western Patagonia in Argentina and extends from -36.8° latitude in Neuquen province to -55.0° latitude in Tierra del Fuego province. From west to east it spans from -73.0° longitude in the Andes Mountains, which is also the border with Chile, to -63.5° longitude in the Patagonian Desert. While in the proximity of the Andes Mountains the elevation ranges from 2000 to 3000 m, in the Patagonian plateau the elevation is a few hundred meters. In terms of land cover and land use, AAPF is not homogeneous for the same reason explained before. Although forest covers most of the area, a considerable area is occupied by non-forest formations, rocky formation and glaciers [@matteucciBreveDescripcionRegiones2021; @10.1016/j.scitotenv.2022.156303] (@figure-main A and B).

The climate in the AAPF region is characterized by a west-to-east precipitation gradient and  a marked rainfall seasonality. According to @cwielongImpactFireNative in a range of 60-70 km, annual rainfall declines from 4000 mm in the west to around 350 mm at the border with the steppe. The rainy season is between June and August, with 70% of annual precipitation, while the dry period is between December and February. Permanent strong western winds (more than 30 km/h), minimum relative humidity below 10% during droughts and temperatures above 30°C have crucial impacts on the behavior of fires all along the region. Fire season extends from October to April with most of the fires happening between January and March (supplementary figure B). Regional statistics shows that 7% of fires are generated from natural causes, while the remaining 93% is attributed to human activities @ministeriodeambienteydesarrollosostenibleInformeAreasQuemadas2021.

# Methodology

Burned area data for the period between 2001 and 2020 for the period between 2001 and 2020 was obtained from the MODIS sensor on Terra satellite @pettinarim.ESACCIECV2021. A fire season was defined from October to March, with its label referring to when the season starts, The latitudinal variability of the data was assessed with a sum of the burned area along the longitudinal axis. The count of active fire seasons during 2001-2019 is shown together with the total burned area in each latitude. ERA5 data was used to characterize the precipitation and orography in the AAPF region, and the Copernicus Global Land Service product was implemented to create a land cover map. For more details about the methodology, see the supplementary material.

# Results and discussion

The main results of this assessment are shown in @figure-main C, which represents an innovative approach to understand the consequences of the fire events, quantified as burned area (bars' colors), that ocurred along the AAFP region during 2001-2019 active fire seasons (bars' length). This methodology allowed us to have a comprehensive analysis of the burned area in a region with a high latitudinal variability, in terms of land cover and land use type (@figure-main A), also in orography (@figure-main B) and climatic variables such as precipitation (supplementary figure D).

```{figure} CISP2024-Burned-Area-Argentinia-2001-2019-figure.png
:name: figure-main
:alt: Multi-panel figure showing land cover map, orography map, and burned area analysis for the Argentinian Andean-Patagonian Forest

\
**A) Land cover and land use map**: Delineates the diversity in the land cover and land use in AAPF. This map highlights the study region's complex geography and provides insightful information about biomass fuel availability among other features. For a detailed description of the product methodology and land cover types, refer to [](doi:10.5281/zenodo.3938963).

**B) Orography map**: Derived from surface geopotential height measurements obtained from the ERA5 reanalysis data, this map presents the orography of the AAPF. It illustrates the elevation gradient from the Andes Mountains to the Patagonian plateau, with values expressed in meters.

\
**C) Count of active fire seasons and its activity by latitude**: The horizontal bar plot shows the count of active fire seasons at different latitudes within the AAPF from 2001 to 2019 fire seasons. Active seasons are defined as periods with fire events covering an area greater than 0.05336 km² (5.3364 ha). The color gradient represents the total burned area in km², indicating the spatial intensity of fires.
```

@figure-main C shows two distinguishable subregions as the most affected during the study period. One is the northern AAPF region between latitude -37.75° and -38.5°. This was the most affected region, in terms of area and counts of active seasons. The second subregion, where a large area was affected in fewer active fire seasons, spans from latitude -42.0° to -42.5°. Regions south to the latitude -42.5° experienced less frequent fires that affected smaller areas. In some latitudes, no relevant burned area data was detected.

The findings align with results within existing literature, which shows that the northern AAPF was the most affected region by fires @secretariadeambienteydesarrollososteniblesaydsPrimerInventarioNacional2005 [](doi:10.5281/zenodo.3938963) @ministeriodeambienteydesarrollosostenibleInformeAreasQuemadas2021. The causes include the expansion of human settlements in the northern AAPF, the introduction of non-fire-adapted exotic species at the expense of native ones, among others. Additionally, the implemented approach enabled an accurate assessment of the burned area between latitudes -42.0° and -42.5° over the past two decades. This zone is situated at the border of Rio Negro and Chubut provinces and has not experienced significant fire events during the study period, despite facing increasing anthropogenic pressure. One exception occurred in 2015, when one of the most substantial fire events took place, leaving a lasting impact until these days @kitzbergerRelacionEntreClima2015 [](doi:10.1016/j.envsoft.2022.105526) (supplementary figure C).

The land cover and land use map (@figure-main A) shows the heterogeneous geography in the AAFP, in line with @matteucciBreveDescripcionRegiones2021 and [](doi:10.1016/j.scitotenv.2022.156303). The ERA5 reanalysis product provided valuable information about AAPF's orography (@figure-main B). ERA5 data was also used to assess the latitudinal total annual precipitation variability (supplementary figure D), which are in concordance with the climatology in our study region @cwielongImpactFireNative. This latitudinal assessment proposes an innovative way to understand the high geographic and climatic variability that affects fire events and its consequences (e.g. burned area) in the AAPF region.

The burned area assessment along the AAPF region obtained in this study provides valuable insights for future research. One open area of research are the teleconnections between fire events and climate variability modes such as ENSO and SAM [](doi:10.1111/j.1442-9993.2010.02236.x) [](doi:10.1029/2018GL078294) [](doi:10.1038/s41467-023-36052-8). Having a better understanding of these phenomena  can help creating models to predict fire risk based on the numerical weather and climate forecast. In summary, this study provides meaningful results to understand the fire regime in AAPF that can later help mitigate climate change impacts in this region.

## Acknowledgments

The authors acknowledge the support provided by the Climatematch Impact Scholars Program (CISP) and the Climatematch community.
