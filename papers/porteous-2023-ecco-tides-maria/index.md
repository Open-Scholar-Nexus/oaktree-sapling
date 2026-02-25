---
title: Observing ECCO Model vs Tide Gauges Affected by Hurricane Maria
abbreviations:
    TG: Tide Gauge
    SSH: Sea Surface Height
    ECCO: Estimating the Circulation and Climate of the Ocean
    UHSLC: University of Hawaii Sea Level Center
    GLOSS: Global Sea Level Observing System
    MDSL: Mean Dynamic Sea Level
abstract: ""
---

# Seminar presentation
```{iframe} https://www.youtube.com/embed/_mT-hI692f8
:width: 100%

This article was presented as part of a series of seminars chaired by scientists from Climatematch Academy’s collaborating organizations, CMIP (Couple Model Intercomparison Project) and LEAP (Learning the Earth with Artificial Intelligence and Physics).
```




# Introduction
Sea level rise is a multifaceted phenomenon where individualized parameterization of changes and data sources is critical to understanding the full extent of future impacts. Tide Gauge (TG) networks and satellites are among the most prolific data sources for tracking global sea level rise. However, numerous mechanical, technical, and calibration issues exist when interpolating data from each source ([](doi:10.3389/fmars.2019.00055)). Finding correlation methods between, for example, TG and satellite altimetry networks provides valuable insight into the weighted measuring system of remote and in-situ observation systems, especially during extreme storm events in understudied areas, such as small island states. 

Looking at the correlation between the Estimating the Circulation and Climate of the Ocean (ECCO) model and the NOAA University of Hawaii Sea Level Center TG network during Hurricane Maria, we contribute to a growing body of literature, analyzing the accuracy of observational weighted systems during extreme storm events using multiple types of statistical corollary analysis. Testing the observational network has significant implications for future climate and storm models ([](doi:10.1029/2007JC004459)), as well as for checking the accuracy of each observational system. 

Our preliminary analysis investigated how the resolution and reliability of SSH data compare between TG and ECCO before, during, and after Hurricane Maria. The insights derived from this analysis led us to extend our focus to the longest available period where both ECCO and TG data are available to observe when differences occur in the measurements of SSH, giving rise to the following research questions: How does the resolution and reliability of SSH data compare between TG and ECCO across the years and during severe weather events? How does the correlation between TG and ECCO reveal the influence of a severe weather event on two measurements of the same property (SSH), and what underlying factors contribute to their divergence? 

By looking at one of the most powerful hurricanes ever recorded, the robustness of each data network can be utilized with more precise placement and value for future modelers and local climate and ocean scientists.

:::{dropdown} Poetic Summary

  In the tempest of climate’s exchange, \
  Hurricane surges pose challenges, strange.  \
  As the storms dance with glee,  \
  Rising tides taunt the sea,  \
  Measuring their might, in flux, a range.  

  For sea heights, a system profound,  \
  Needs remote and in-situ, all around.  \
  With observations remote,  \
  And in-situ, afloat,  \
  Accurate measures in waves are found.  \
  \
  From the ocean, where measurements align,  \
  UHSLC and ECCO, both shine.  \
  With gauges on the coast,  \
  And satellites boast,  \
  Accurate heights, in data they twine.  \
  \
  In Fall’s embrace, Maria did soar,  \
  A hurricane mighty, waves did implore.  \
  With waves quite so high,  \
  Above the mean sea, oh my,  \
  NWS sought truth on the shore.  \
  \
  Accurate info, they plead and demand,  \
  For Maria’s surge, like a forceful hand.  \
  2.35 to 5.44 meters it rose,  \
  A tale that Puerto Rico knows,  \
  In storm surge data, their safety is planned.  \
  \
  In Isabel Segunda, waves gauge with pride,  \
  Tidal dance in Esperanza’s tide.  \
  Arecibo stands tall,  \
  Mayaguez hears the call,  \
  Fajardo’s gauge, where sea levels bide.  \
  \
  Years ‘92 to ‘17, ECCO’s seas,  \
  Surface heights dancing with gentle ease.  \
  Rolling means in the tide gauge,  \
  Pearson correlation, a data stage,  \
  In the waves of comparison, both aim to please.  \
  \
  Round ECCO grid cells, a tale to unfold,  \
  Transformed into an array, so bold.  \
  With plots to compare,  \
  In data’s vibrant lair,  \
  A visual dance, a story to be told.  \
  \
  In the dance of tide gauges, so fine,  \
  Selecting a spot, a perfect align.  \
  ECCO grid cells embrace,  \
  Daily averages in grace,  \
  Acceptable errors, in data they twine.  \
  \
  Pearson correlation, a link so bright,  \
  ECCO and tidal gauges unite.  \
  In climate’s crystal ball,  \
  And hurricane’s squall,  \
  Prediction’s key for the future’s insight.
:::

# Description
Maria was an extremely severe Hurricane that hit Dominica at a category 5 (on the Saffir-Simpson Hurricane Wind Scale) and later devastated Puerto Rico as a high-end category 4 hurricane, tracked from September 17th to October 2nd of 2017 with pressures reaching 908 MB and wind reaching 150 knots (@paschNOAANHCTropical). The storm surge in Puerto Rico during Maria’s landfall ranged from 2.35 to 5.44 meters above the mean sea level for the region (@usdepartmentofcommerceMajorHurricaneMaria). Knowledge of how the SSH is modeled in ECCO vs verified in the TG network shows the extent they can be relied on during a severe storm. 

The sea level data from TGs are different from SSH measured by satellite altimeters because the latter is measured relative to a global reference frame (not local benchmarks). Therefore, SSH data from satellite altimeters are unaffected by land movement ([](doi:10.7289/v5v40s7w)). 

Tracking the changes in sea level and SSH as they relate to extreme storm events is critical for storm prediction analysis. Tidal amplitudes and phases are affected by determinants such as higher average temperatures and more extreme storms, including changes in coastal morphology, extent of ice sheets, and baroclinicity ([](doi:10.1029/2018RG000636)). Changes in tides, at the local level include absolute and relative ranges and spring tide maximums, all of which contribute to a hurricane surge. These nonlinear interactions between water depth, tide, waves, wind forcing, and atmospheric surge lead to changes in the peak water levels and synoptic sea level fluctuations which vary significantly from the changes in the global average sea level ([](doi:10.1016/j.coastaleng.2014.12.002)); ([](doi:10.1007/s10712-019-09549-5)); ([](doi:10.1038/s41467-023-40848-z)), therefore localized analysis of SSH before, during, and after a storm are critical for understanding the local future storm projections and predictions. 

# Methods
We used ECCO Version 4: Fourth Release (ECCO v4r4)[^ecco-access], dated from 1992 to 2017, with a grid cell resolution interpolated to a 0.5-degree latitude-longitude. While this still has a lower resolution around low latitudes, the difference in grid cells is scaled at 1/48° and refined in the meridional direction to resolve the tropical system of zonal currents better ([](doi:10.5194/gmd-8-3071-2015)). We extracted the daily values of SSH from precise corresponding to the TG available in Maria’s trajectory in the 17-18° latitudinal range [^meridional]. SSH values from the TGs at these locations thanks to the University of Hawaii Sea Level Center ([UHSLC](https://uhslc.soest.hawaii.edu/network/)), a member of the Global Sea Level Observing System (GLOSS).

We used the six TGs in Puerto Rico active during Hurricane Maria (i.e., Penuelas, Isabel Segunda, Esperanza, Arecibo, Mayaguez, and Fajardo)[^tg-timeseries], and chose the nearest ECCO grid cell corresponding to the coordinate for each location. For the preliminary analysis, we plotted the normalized time series for TG and ECCO a month before, during the dates of, and a month after Hurricane Maria (see [Part A](#fig-main)). Bland-Altman analysis (see [Part B](#fig-main)) and correlation measures were used. Expanding the analysis, SSH time series for the longest available time for each TG, including Hurricane Maria's timeframe, against ECCO, for the same period, were plotted for comparison (see [Part C](#fig-main)). To smoothen the temporal coarseness of the SSH data, both TG and ECCO time series were put through a 1000-hour rolling window computing the mean and standard deviation of the data (see [Part D and E](#fig-main)). We then calculated the Pearson correlation coefficients of the ECCO and TG rolling means and rolling standard deviations (see [Part F](#fig-main)).

```{figure} CISP2024-ECCO-TideGauges-HurricaneMaria-figure.svg
:name: fig-main
:align: center

**Part A:** Normalized time series for TG and ECCO around Hurricane Maria. **Part B:** Bland-Altman analysis. **Part C:** SSH time series comparison for longest available period. **Part D and E:** Rolling mean and standard deviation (1000-hour window). **Part F:** Pearson correlation coefficients.
```

# Discussion
Preliminary results suggest that TGs have a higher degree of localized accuracy than ECCO, but could be faulty during an extreme event, therefore it is necessary to understand better the correlation between ECCO and TGs over larger time scales. Next, a time series analysis of SSH data showing the intersection between the TG and ECCO reveals that the SSH data is incomplete for some time series, i.e., Fajardo, suggesting that the TG was destroyed. Furthermore, the amplitude and variability of the TG data is higher than the normalized ECCO data. Pearson correlation coefficients[^pearson] calculated from the rolling mean and standard deviation for TG and ECCO time series show the following relationships: Fajardo, Mayaguez, and Arecibo show a strong positive correlation, Esperanza shows a moderate positive correlation and Isabel Segunda shows a weak positive correlation for the rolling mean. Isabel Segunda shows a weak positive correlation, Esperanza and Arecibo show a weak negative correlation, while Mayaguez and Fajardo show almost no correlation for the rolling standard deviation. 

In conclusion, ECCO is fairly reliable over long time scales but hardly accounts for rise in SSH due to extreme weather events. Furthermore, although TGs seem more accurate over short time scales, especially in depicting rise in SSH during extreme events, TGs are vulnerable to extreme weather. Understanding the correlation between ECCO and TGs may quantify the extent to which researchers can rely on TG data with increasing range in SSH and, in turn, give insight into the reliability of ECCO SSH during those extreme events. This may provide valuable information regarding its use for locations lacking TGs.

# Future Work
Further investigation is needed on other atmospheric conditions such as steric height, or the parcel of the ocean that has a different density due to changes in temperature and salinity. These “thermosteric” and “halosteric” changes are key when analyzing SSH under an ever-changing ocean. Shifting baselines will have a degree of impact on local mean dynamic sea level (MDSL), tidal range, and wave pattern as well as in hurricane-induced water levels ([](doi:10.1029/2020JC016869)). Taking into consideration bottom drag coefficients to better determine tidal energy displacement via continental shelves will also be necessary for fully parameterized detail of storm anomalies effects since the North East Caribbean is two continental plates ([](doi:10.1002/jgrc.20305)). All in all, this work could inform the Sea Level Explorer Visualizer [tool](https://ccar.colorado.edu/altimetry/) to help account for the differences in TGs and altimetry systems writ large.

[^meridional]: Meridional ranges in the ECCO model only vastly increase at the -10° to 10° latitude, which is outside of our current range, but still critical mapping information when comparing global ocean state mapping.

[^ecco-access]: In order to access ECCO data, one must make an account with a unique username and password to utilize the python code.

[^tg-timeseries]: The precise time series for each tidal gauge are as follows. 4/5 TGs were established after ECCO so the time series starts with the establishment of the TG; however, Fajardo began in 1921, but only the data with ECCO is used, so the time series starts on January 1st, 1992.

    | Location name (Station ID) | TG start       | Absolute start | Absolute End   | TG ends        |
    | :------------------------- | :------------- | -------------- | -------------- | -------------- |
    | Isabel Segunda, PR (732)   | (2009, 03, 07) | (2009, 03, 07) | (2017, 10, 19) | (2017, 10, 19) |
    | Esperanza, PR (733)        | (2005, 08, 16) | (2005, 08, 16) | (2017, 12, 31) | (2019, 12, 31) |
    | Arecibo, PR (735)          | (2008, 08, 29) | (2008, 08, 29) | (2017, 12, 31) | (2017, 12, 31) |
    | Mayaguez, PR (736)         | (2008, 03, 11) | (2008, 03, 11) | (2017, 12, 31) | (2019, 12, 31) |
    | Fajardo, PR (783b)         | (2008, 10, 07) | (2008, 10, 07) | (2017, 12, 31) | (2017, 09, 19) |

[^pearson]: The Pearson's correlation coefficients and P-values are all rounded to two decimal places.